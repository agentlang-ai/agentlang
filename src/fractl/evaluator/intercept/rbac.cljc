(ns fractl.evaluator.intercept.rbac
  (:require [clojure.set :as set]
            [fractl.component :as cn]
            [fractl.util :as u]
            [fractl.util.seq :as su]
            [fractl.store :as store]
            [fractl.env :as env]
            [fractl.meta :as mt]
            [fractl.lang.internal :as li]
            [fractl.lang.relgraph :as rg]
            [fractl.rbac.core :as rbac]
            [fractl.global-state :as gs]
            [fractl.resolver.registry :as rr]
            [fractl.evaluator.intercept.internal :as ii]))

(defn- has-priv? [rbac-predic user arg]
  (let [data (:data arg)
        p (partial rbac-predic user)
        rec-name
        (cond
          (keyword? data) data

          (cn/an-instance? data)
          (cn/instance-type data)

          (li/parsed-path? data)
          (li/make-path data)

          :else
          (u/throw-ex (str "invalid argument for rbac interceptor - " data)))]
    (if rec-name
      (p (assoc arg :data rec-name))
      (let [rs (set (map cn/instance-type data))]
        (su/all-true? (map #(p (assoc arg :data %)) rs))))))

(def ^:private apply-create-rules (partial has-priv? rbac/can-create?))
(def ^:private apply-update-rules (partial has-priv? rbac/can-update?))
(def ^:private apply-read-rules (partial has-priv? rbac/can-read?))
(def ^:private apply-delete-rules (partial has-priv? rbac/can-delete?))
(def ^:private apply-eval-rules (partial has-priv? rbac/can-eval?))

(def ^:private actions
  {:update apply-update-rules
   :create apply-create-rules
   :read apply-read-rules
   :delete apply-delete-rules
   :eval apply-eval-rules})

(defn- contains-env? [obj]
  (and (seqable? obj)
       (env/env? (second obj))))

(defn- extract-read-results [obj]
  (if (contains-env? obj)
    (first obj)
    obj))

(defn- set-read-results [obj rslt]
  (if (contains-env? obj)
    (concat [rslt] (rest obj))
    rslt))

(defn- has-instance-privilege? [user opr resource]
  (some #{opr} (cn/instance-privileges-for-user resource user)))

(defn- owner-exclusive? [resource]
  (li/owner-exclusive-crud
   (cn/fetch-meta (if (keyword? resource)
                    resource
                    (cn/instance-type-kw resource)))))

(defn- handle-rbac-entity [tag update-inst user env opr inst is-system-event]
    (let [entity-name (:Resource inst)
          id (:ResourceId inst)
          store (env/get-store env)
          res (store/lookup-by-id
               store entity-name
               (cn/identity-attribute-name entity-name) id)]
      (when-not res
        (u/throw-ex (str "resource not found - " [entity-name id])))
      (when-not is-system-event
        (when-not (cn/user-is-owner? user res)
          (u/throw-ex (str "only owner can assign " (name tag) " privileges - " [entity-name id]))))
      (let [assignee (:Assignee inst)]
        (if (store/update-instances store entity-name (update-inst res assignee))
          inst
          (u/throw-ex (str "failed to assign " (name tag) " privileges - " [entity-name id]))))))

(def ^:private instance-priv-assignment?
  (partial cn/instance-of? :Fractl.Kernel.Rbac/InstancePrivilegeAssignment))

(defn- handle-instance-priv [user env opr inst is-system-event]
  (if (or (= opr :create) (= opr :delete))
    (handle-rbac-entity :instance (fn [res assignee]
                                    (let [actions (when (= opr :create) (:Actions inst))]
                                      [(if actions
                                         (cn/assign-instance-privileges res assignee actions)
                                         (cn/remove-instance-privileges res assignee))]))
                        user env opr inst is-system-event)
    inst))

(def ^:private ownership-assignment?
  (partial cn/instance-of? :Fractl.Kernel.Rbac/OwnershipAssignment))

(defn- handle-ownership-assignment [user env opr inst is-system-event]
  (if (or (= opr :create) (= opr :delete))
    (handle-rbac-entity :ownership (fn [res assignee]
                                     [(if (= opr :create)
                                        (cn/concat-owners res #{assignee})
                                        (cn/remove-owners res #{assignee}))])
                        user env opr inst is-system-event)
    inst))

(defn- maybe-force [p]
  (if (and p (fn? p))
    (p)
    p))

(defn- has-between-ownership? [owner? relname between-nodes]
  (if-let [owner-node (:owner (cn/fetch-rbac-spec relname))]
    (owner? (owner-node between-nodes))
    (every? owner? (vals between-nodes))))

(defn- apply-rbac-checks [user env opr arg resource check-input]
  (cond
    (instance-priv-assignment? resource)
    (when (handle-instance-priv user env opr resource false) arg)

    (ownership-assignment? resource)
    (when (handle-ownership-assignment user env opr resource false) arg)

    :else
    (let [owner? (partial cn/user-is-owner? user)
          has-base-priv ((opr actions) user check-input)]
      (if (= :create opr)
        (or (and has-base-priv arg)
            (let [inst-type (when (cn/an-instance? resource) (cn/instance-type-kw resource))
                  rel-ctx (when inst-type (inst-type (env/relationship-context env)))
                  [parent between-nodes] (when rel-ctx
                                           [(maybe-force (:parent rel-ctx))
                                            (dissoc rel-ctx :parent)])
                  has-owner-privs (or (and parent (owner? parent))
                                      (when (seq between-nodes)
                                        (has-between-ownership? owner? inst-type between-nodes)))]
              (and has-owner-privs arg)))
        (let [is-owner (owner? resource)
              has-inst-priv (when-not is-owner (has-instance-privilege? user opr resource))]
          (if (or is-owner has-inst-priv)
            arg
            (if has-base-priv
              (case opr
                :read arg
                (:delete :update) (when-not (owner-exclusive? resource) arg)))))))))

(defn- first-instance [data]
  (cond
    (keyword? data) data
    (map? data) data
    (and (seqable? data) (cn/an-instance? (first data)))
    (first data)
    :else data))

(defn- apply-rbac-for-user [user env opr arg]
  (let [check (partial apply-rbac-checks user env opr arg)]
    (if-let [data (ii/data-input arg)]
      (if (or (ii/skip-for-input? data) (= opr :read))
        arg
        (let [is-delete (= :delete opr)
              resource (if is-delete (second data) (first-instance data))
              check-on (if is-delete (first data) resource)
              ign-refs (or is-delete (= :read opr))]
          (check resource {:data check-on :ignore-refs ign-refs})))
      (if-let [data (seq (ii/data-output arg))]
        (if (ii/skip-for-output? data)
          arg
          (if (= opr :read)
            (if-let [rs (seq (extract-read-results data))]
              (when-let [rslt (seq (filter #(check % {:data % :ignore-refs true}) rs))]
                (ii/assoc-data-output arg (set-read-results data rslt)))
              arg)
            arg))
        arg))))

(defn- check-upsert-on-attributes [user env opr arg]
  ;; TODO: attributes rbac needs re-design.
  arg)

(defn- fetch-instance [opr data]
  (if (= opr :create)
    (first-instance data)
    (second data)))

(defn- fetch-crdel-instance [opr arg]
  (when-let [data (ii/data-input arg)]
    (when (and (or (= opr :create) (= opr :delete))
               (not (ii/skip-for-input? arg)))
      (fetch-instance opr data))))

(defn- maybe-handle-system-objects [user env opr arg]
  (if-let [resource (fetch-crdel-instance opr arg)]
    (cond
      (instance-priv-assignment? resource)
      (when (handle-instance-priv user env opr resource true) arg)

      (ownership-assignment? resource)
      (when (handle-ownership-assignment user env opr resource true) arg)
      :else arg)
    arg))

(def ^:private system-events #{[:Fractl.Kernel.Identity :SignUp]
                               [:Fractl.Kernel.Identity :PostSignUp]
                               [:Fractl.Kernel.Identity :ForgotPassword]
                               [:Fractl.Kernel.Identity :ConfirmForgotPassword]
                               [:Fractl.Kernel.Identity :ConfirmSignUp]})

(defn- system-event? [inst]
  (when-let [t (cn/instance-type inst)]
    (or (cn/an-internal-event? t)
        (some #{(li/split-path t)} system-events))))

(defn- parse-ownership-spec [inst]
  (when-let [spec (:ownership
                   (:assign
                    (cn/fetch-rbac-spec (cn/instance-type-kw inst))))]
    (when (and (= (count spec) 3)
               (= :-> (second spec)))
      [(first spec) (nth spec 2)])))

(defn- maybe-delegate-ownership! [env inst]
  (when-let [[from to] (parse-ownership-spec inst)]
    (let [rel-ctx ((cn/instance-type-kw inst) (env/relationship-context env))
          from-inst (from rel-ctx)
          to-inst (to rel-ctx)]
      (when-not from-inst
        (u/throw-ex (str "ownership delegation failed, instance not found for " from)))
      (when-not to-inst
        (u/throw-ex (str "ownership delegation failed, instance not found for " to)))
      (let [to-type (cn/instance-type-kw to-inst)
            id ((cn/identity-attribute-name to-type) to-inst)]
        (doseq [owner (set/difference (cn/owners from-inst) (cn/owners to-inst))]
          (let [inst (cn/make-instance :Fractl.Kernel.Rbac/OwnershipAssignment
                                       {:Resource to-type
                                        :ResourceId id
                                        :Assignee owner})]
            (handle-ownership-assignment nil env :create inst true)))))))

(defn- maybe-revoke-ownership! [env inst]
  (when-let [[from to] (parse-ownership-spec inst)]
    (let [rel-ctx ((env/load-between-refs env) inst)
          from-inst (from rel-ctx)
          to-inst (to rel-ctx)]
      (when-not from-inst
        (u/throw-ex (str "failed to revoke ownership, instance not found for " from)))
      (when-not to-inst
        (u/throw-ex (str "failed to revoke ownership, instance not found for " to)))
      (let [to-type (cn/instance-type-kw to-inst)
            id ((cn/identity-attribute-name to-type) to-inst)]
        (doseq [owner (set/intersection (cn/owners from-inst) (cn/owners to-inst))]
          (let [inst (cn/make-instance :Fractl.Kernel.Rbac/OwnershipAssignment
                                       {:Resource to-type
                                        :ResourceId id
                                        :Assignee owner})]
            (handle-ownership-assignment nil env :delete inst true)))))))

(defn- post-process [env opr arg]
  (when-let [inst (fetch-crdel-instance opr arg)]
    (when (cn/between-relationship-instance? inst)
      (case opr
        :create (maybe-delegate-ownership! env inst)
        :delete (maybe-revoke-ownership! env inst))))
  arg)

(defn- run [env opr arg]
  (let [user (or (cn/event-context-user (ii/event arg))
                 (gs/active-user))]
    (if (or (rbac/superuser-email? user)
            (system-event? (ii/event arg)))
      (maybe-handle-system-objects user env opr arg)
      (let [is-ups (or (= opr :update) (= opr :create))
            arg (if is-ups (ii/assoc-user-state arg) arg)]
        (when-let [r (apply-rbac-for-user user env opr arg)]
          (and (post-process env opr arg) r))
        ;; TODO: call check-upsert-on-attributes for create/update
        ))))

(defn make [_] ; config is not used
  (ii/make-interceptor :rbac run))
