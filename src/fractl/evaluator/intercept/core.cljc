(ns fractl.evaluator.intercept.core
  (:require [fractl.util :as u]
            [fractl.component :as cn]
            [fractl.env :as env]
            [fractl.evaluator.intercept.internal :as ii]))

;; Manages a pipeline of interceptors.
;; Interceptors are executed in the order they are added
;; to the pipeline, the output of the first becoming the
;; input for the second and so on. The result of the final
;; interceptor will be returned to the caller - usually this
;; will be the root evaluator.
;;
;; An interceptor is represented by a map with
;; two keys - `:name` and `:fn`. `:name` uniquely
;; identifies the interceptor and `:fn` is a two-argument
;; function that performs the intercept operation. The first
;; argument identifies the operation, which should be
;; one of - `[:read :upsert :delete :eval]`. The second argument
;; must be a map with at least two keys - `:user` and `:data`.
;; `:user` is the name of the currently logged-in `:Kernel.Identity/User`
;; and data could be an entity instance, a list of entity instances
;; or the name of an entity.
;;
;; An interceptor may or may not transform the data, but its
;; return value must be encoded in the same format as its second
;; argument, so that it can become the input for the next interceptor
;; in the pipeline. An interceptor may terminate the pipeline by
;; returning nil
(def ^:private interceptors (u/make-cell []))
(def ^:private system-interceptors #{:instance-meta :rbac})

(defn- system-interceptor? [interceptor]
  (some #{(ii/intercept-name interceptor)} system-interceptors))

(defn add-interceptor! [spec]
  (let [n (ii/intercept-name spec) f (ii/intercept-fn spec)]
    (if (and n f)
      (do (u/call-and-set
           interceptors
           (fn []
             (let [ins @interceptors]
               (if-not (some #{n} (mapv ii/intercept-name ins))
                 (conj ins spec)
                 (u/throw-ex (str "duplicate interceptor - " n))))))
          (ii/intercept-name spec))
      (u/throw-ex (str ii/intercept-name " and " ii/intercept-fn " required in interceptor spec - " spec)))))

(defn reset-interceptors! []
  (u/safe-set interceptors []))

(defn- invoke-for-output [opr env event-instance data]
  (loop [ins @interceptors
         result (ii/encode-output-arg event-instance data ins)]
    (if-let [i (first ins)]
      (if-let [r ((ii/intercept-fn i)
                  (when (system-interceptor? i) env) opr result)]
        (recur (rest ins) r)
        (u/throw-ex (str "operation " opr " blocked by interceptor for output " (ii/intercept-name i))))
      (ii/data-output result))))

(defn invoke-interceptors [opr env data continuation]
  (if-let [ins (seq @interceptors)]
    (let [event-instance (env/active-event env)]
      (loop [ins ins
             result (ii/encode-input-arg event-instance data ins)]
        (if-let [i (first ins)]
          (if-let [r ((ii/intercept-fn i)
                      (when (system-interceptor? i) env) opr result)]
            (recur (rest ins) r)
            (u/throw-ex (str "operation " opr " blocked by interceptor " (ii/intercept-name i))))
          (invoke-for-output opr env event-instance (continuation (ii/data-input result))))))
    (continuation data)))

(def ^:private read-operation (partial invoke-interceptors :read))
(def ^:private upsert-operation (partial invoke-interceptors :upsert))
(def ^:private delete-operation (partial invoke-interceptors :delete))
(def ^:private eval-operation (partial invoke-interceptors :eval))

(defn- do-intercept-opr [intercept-fn env data continuation]
  (if (env/interceptors-blocked? env)
    (continuation data)
    (intercept-fn env data continuation)))

(def read-intercept (partial do-intercept-opr read-operation))
(def upsert-intercept (partial do-intercept-opr upsert-operation))
(def delete-intercept (partial do-intercept-opr delete-operation))
(def eval-intercept (partial do-intercept-opr eval-operation))
