(ns fractl.evaluator.intercept.rbac
  (:require [clojure.set :as set]
            [fractl.component :as cn]
            [fractl.util :as u]
            [fractl.util.seq :as su]
            [fractl.store :as store]
            [fractl.env :as env]
            [fractl.lang.internal :as li]
            [fractl.rbac.core :as rbac]
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

(def ^:private apply-upsert-rules (partial has-priv? rbac/can-upsert?))
(def ^:private apply-read-rules (partial has-priv? rbac/can-read?))
(def ^:private apply-delete-rules (partial has-priv? rbac/can-delete?))
(def ^:private apply-eval-rules (partial has-priv? rbac/can-eval?))

(def ^:private actions
  {:upsert apply-upsert-rules
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

(defn- make-read-output-arg [old-output-data new-insts]
  (if (contains-env? old-output-data)
    (concat [new-insts] (rest old-output-data))
    new-insts))

(defn- apply-read-attribute-rules [user rslt arg]
  (let [inst (first rslt)
        attr-names (keys (cn/instance-attributes inst))
        inst-type (cn/instance-type inst)
        res-names (mapv (partial ii/wrap-attribute inst-type) attr-names)
        readable-attrs (or (seq
                            (mapv
                             #(first (:refs (li/path-parts %)))
                             (filter #(apply-read-rules user {:data %}) res-names)))
                             attr-names)
        hidden-attrs (set/difference (set attr-names) (set readable-attrs))
        new-insts (mapv #(apply dissoc % hidden-attrs) rslt)]
    (ii/assoc-data-output
     arg (make-read-output-arg (ii/data-output arg) new-insts))))

(defn- user-is-owner?
  ([user env data]
   (when (cn/entity-instance? data)
     (user-is-owner?
      user env
      (cn/instance-type data)
      (cn/idval data))))
  ([user env inst-type id]
   (when (and inst-type id)
     (when-let [meta (store/lookup-by-id
                      (env/get-store env)
                      (cn/meta-entity-name inst-type)
                      cn/meta-entity-id (str id))]
       (= (cn/instance-meta-owner meta) user)))))

(defn- first-instance [data]
  (cond
    (keyword? data) data
    (map? data) data
    (and (seqable? data) (cn/an-instance? (first data)))
    (first data)
    :else data))

(defn- check-instance-privilege
  ([env truth user opr resource on-rbac]
   (cond
     (rbac/superuser-email? user) truth

     (and (or (= opr :upsert) (= opr :delete))
          (rbac/instance-privilege-assignment-object? resource))
     (user-is-owner?
      user env
      (rbac/instance-privilege-assignment-resource resource)
      (rbac/instance-privilege-assignment-resource-id resource))

     :else
     (case (rbac/check-instance-privilege user opr resource)
       :allow truth
       :block false
       :rbac (on-rbac))))
  ([env user opr resource on-rbac]
   (check-instance-privilege env true user opr resource on-rbac)))

(defn- run [env opr arg]
  (if-let [data (ii/data-input arg)]
    (if (ii/skip-for-input? data)
      arg
      (let [is-delete (= :delete opr)
            user (cn/event-context-user (ii/event arg))
            resource (if is-delete (second data) (first-instance data))
            check-on (if is-delete (first data) resource)
            ign-refs (and (not is-delete)
                          (not (ii/attribute-ref? resource))
                          (or (= :read opr) (= :upsert opr)))]
        (when (or (and (ii/has-instance-meta? arg)
                       (user-is-owner? user env resource))
                  (check-instance-privilege
                   env user opr resource
                   #((opr actions)
                     user
                     {:data check-on
                      :ignore-refs ign-refs})))
          arg)))
    (if-let [data (seq (ii/data-output arg))]
      (cond
        (ii/skip-for-output? data)
        arg

        (= :read opr)
        (let [user (cn/event-context-user (ii/event arg))
              rslt (extract-read-results data)]
          (if (and (ii/has-instance-meta? arg)
                   (every? (partial user-is-owner? user env) rslt))
            arg
            (check-instance-privilege
             env arg user opr rslt
             #(apply-read-attribute-rules user rslt arg))))

        :else arg)
      arg)))

(defn make [_] ; config is not used
  (ii/make-interceptor :rbac run))
