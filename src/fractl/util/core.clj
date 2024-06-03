(ns fractl.util.core
  (:require
    clojure.main
    clojure.test
    [clojure.java.io :as io]
    [clojure.string :as s]
    [fractl.util :as u]
    [fractl.util.seq :as su]
    [fractl.util.logger :as log]
    [fractl.resolver.registry :as rr]
    [fractl.compiler :as c]
    [fractl.component :as cn]
    [fractl.evaluator :as e]
    [fractl.evaluator.intercept :as ei]
    [fractl.store :as store]
    [fractl.global-state :as gs]
    [fractl.lang.rbac :as lr]
    [fractl.lang.tools.loader :as loader]
    [fractl.lang.tools.build :as build]
    [fractl.auth :as auth]
    [fractl.rbac.core :as rbac]
    [fractl-config-secrets-reader.core :as fractl-secret-reader]))

(def ^:private repl-mode-key :-*-repl-mode-*-)
(def ^:private repl-mode? repl-mode-key)
(def ^:private on-init-fn (atom nil))
(def config-data-key :-*-config-data-*-)
(def resource-cache (atom nil))

(defn complete-model-paths [model current-model-paths config]
  (let [mpkey :model-paths
        mp (or (mpkey model)
               (mpkey config)
               ".")]
    (set
     (concat
      current-model-paths
      (if (vector? mp)
        mp
        [mp])))))

(defn store-from-config [config]
  (or (:store-handle config)
      (e/store-from-config (:store config))))

(defn set-aot-dataflow-compiler! [config]
  (when-let [store (store-from-config config)]
    (cn/set-aot-dataflow-compiler!
     (partial
      c/maybe-compile-dataflow
      (partial store/compile-query store)))))

(defn load-components [components model-root config]
  (set-aot-dataflow-compiler! config)
  (loader/load-components components model-root))

(defn load-components-from-model [model model-root config]
  (set-aot-dataflow-compiler! config)
  (loader/load-components-from-model
   model model-root
   (:load-model-from-resource config)))

(defn load-model [model model-root model-paths config]
  (loader/load-model
   model model-root
   (complete-model-paths model model-paths config)
   (:load-model-from-resource config)))

(defn log-seq! [prefix xs]
  (loop [xs xs, sep "", s (str prefix " - ")]
    (when-let [c (first xs)]
      (let [s (str s sep c)]
        (if-let [cs (seq (rest xs))]
          (recur cs " " s)
          (log/info s))))))

(defn register-resolvers! [config evaluator]
  (when-let [resolver-specs (:resolvers config)]
    (when-let [rns (rr/register-resolvers resolver-specs)]
      (log-seq! "Resolvers" rns)))
  (when-let [auth-config (:authentication config)]
    (when (auth/setup-resolver auth-config evaluator)
      (log/info "authentication resolver inited"))))

(defn model-name-from-args [args]
  (and (seq (su/nonils args))
       (= (count args) 1)
       (let [f (first args)]
         (and (s/ends-with? f (u/get-model-script-name))
              f))))

(defn maybe-read-model [args]
  (when-let [n (and args (model-name-from-args args))]
    (loader/read-model n)))

(defn log-app-init-result! [result]
  (cond
    (map? result)
    (let [f (if (= :ok (:status result))
              log/info
              log/error)]
      (f (str "app-init: " result)))

    (seqable? result)
    (doseq [r result] (log-app-init-result! r))

    :else (log/error (str "app-init: " result))))

(defn trigger-appinit-event! [evaluator data]
  (let [result (evaluator
                (cn/make-instance
                 {:Fractl.Kernel.Lang/AppInit
                  {:Data (or data {})}}))]
    (log-app-init-result! result)))

(defn run-appinit-tasks! [evaluator init-data]
  (e/save-model-config-instances)
  (trigger-appinit-event! evaluator init-data))

(defn merge-resolver-configs [app-config resolver-configs]
  (let [app-resolvers (:resolvers app-config)]
    (mapv
     #(let [n (:name %)]
        (if-let [ac (first
                     (filter
                      (fn [x] (= (:name x) n))
                      app-resolvers))]
          (assoc % :config (merge (:config ac) (:config %)))
          %))
     resolver-configs)))

(defn run-initconfig [app-config evaluator]
  (let [result (evaluator
                (cn/make-instance
                 {:Fractl.Kernel.Lang/InitConfig {}}))
        configs (first (mapv :Data (:result (first result))))
        resolver-configs (merge-resolver-configs
                          app-config
                          (vec
                           (apply
                            concat
                            (mapv :resolvers configs))))
        other-configs (mapv #(dissoc % :resolvers) configs)]
    (merge
     (assoc
      (apply merge other-configs)
      :resolvers resolver-configs)
     (dissoc app-config :resolvers))))

(defn set-on-init! [f] (reset! on-init-fn f))

(defn init-schema? [config]
  (if-let [[_ f] (find config :init-schema?)]
    f
    true))

(defn init-runtime [model config]
  (let [store (store-from-config config)
        ev ((if (repl-mode? config)
              e/internal-evaluator
              e/public-evaluator)
            store)
        ins (:interceptors config)]
    (when (or (not (init-schema? config)) (store/init-all-schema store))
      (let [resolved-config (run-initconfig config ev)
            has-rbac (some #{:rbac} (keys ins))]
        (if has-rbac
          (lr/finalize-events ev)
          (lr/reset-events!))
        (register-resolvers! config ev)
        (when (seq (:resolvers resolved-config))
          (register-resolvers! resolved-config ev))
        (when-let [f @on-init-fn]
          (f)
          (reset! on-init-fn nil))
        (run-appinit-tasks! ev (or (:init-data model)
                                   (:init-data config)))
        (when has-rbac
          (when-not (rbac/init (merge (:rbac ins) (:authentication config)))
            (log/error "failed to initialize rbac")))
        (ei/init-interceptors ins)
        [ev store]))))

(defn finalize-config [model config]
  (let [final-config (merge (:config model) config)]
    (gs/merge-app-config! final-config)
    final-config))

(defn make-server-config [app-config]
  (assoc (:service app-config) :authentication
         (:authentication app-config)))

(defn prepare-runtime
  ([args [[model model-root] config]]
   (let [config (finalize-config model config)
         store (e/store-from-config (:store config))
         config (assoc config :store-handle store)
         components (or
                     (if model
                       (load-model model model-root nil config)
                       (load-components args (:component-root config) config))
                     (cn/component-names))]
     (when (and (seq components) (every? keyword? components))
       (log-seq! "Components" components))
     [(init-runtime model config) config]))
  ([model-info] (prepare-runtime nil model-info)))

(defn prepare-repl-runtime [[[model model-root] config]]
  (prepare-runtime [[model model-root] (assoc config repl-mode-key true)]))

(defn find-model-to-read [args config]
  (or (seq (su/nonils args))
      [(:full-model-path config)]))

(defn preproc-config [config]
  (if (:rbac-enabled config)
    (let [opt (:service config)
          serv (if-not (find opt :call-post-sign-up-event)
                 (assoc opt :call-post-sign-up-event true)
                 opt)
          auth (or (:authentication config)
                   {:service :cognito
                    :superuser-email (u/getenv "FRACTL_SUPERUSER_EMAIL" "superuser@superuser.com")
                    :whitelist? false})
          opt (:interceptors config)
          inter (if-not (:rbac opt)
                  (assoc opt :rbac {:enabled true})
                  opt)]
      (assoc (dissoc config :rbac-enabled)
             :service serv
             :authentication auth
             :interceptors inter))
    config))

(defn load-config [options]
  (preproc-config
   (u/read-config-file (get options :config "config.edn"))))

(defn read-model-and-config
  ([args options]
   (let [config (or (config-data-key options) (load-config options))]
     (when-let [extn (:script-extn config)]
       (u/set-script-extn! extn))
     (let [[model _ :as m] (maybe-read-model (find-model-to-read args config))
           config (merge (:config model) config)]
       (try
         [m (fractl-secret-reader/read-secret-config config)]
         (catch Exception e
           (u/throw-ex (str "error reading secret config " e)))))))
  ([options] (read-model-and-config nil options)))

(defn read-model-from-resource [component-root]
  (let [^String s (slurp
                   (io/resource
                    (str "model/" component-root "/" (u/get-model-script-name))))]
    (if-let [model (loader/read-model-expressions (io/input-stream (.getBytes s)))]
      model
      (u/throw-ex (str "failed to load model from " component-root)))))

(defn load-model-from-resource []
  (when-let [cfgres (io/resource "config.edn")]
    (let [config (read-string (slurp cfgres))]
      (when-let [extn (:script-extn config)]
        (u/set-script-extn! extn))
      (if-let [component-root (:component-root config)]
        (let [model (read-model-from-resource component-root)
              config (merge (:config model) config)
              components (load-model
                          model component-root nil
                          (assoc config :load-model-from-resource true))]
          (when (seq components)
            (log-seq! "Components loaded from resources" components)
            (let [r [config model components]]
              (reset! resource-cache r) r)))
        (u/throw-ex "component-root not defined in config")))))

(defn merge-options-with-config [options]
  (let [basic-config (load-config options)]
    [basic-config (assoc options config-data-key basic-config)]))

(defn call-after-load-model
  ([model-name f ignore-load-error]
   (gs/in-script-mode!)
   (when (try
           (build/load-model model-name)
           (catch Exception ex
             (if ignore-load-error true (throw ex))))
     (f)))
  ([model-name f]
   (call-after-load-model model-name f false)))

(defn force-call-after-load-model [model-name f]
  (try
    (call-after-load-model model-name f)
    (catch Exception ex
      (println (str "ERROR - " (.getMessage ex)))
      (f))))

(defn run-repl-func [options model-fn]
  (fn [args]
    (let [opt (first args)
          with-logs (= opt ":with-logs")
          remaining-args (if with-logs (rest args) (do (log/log-capture! :fractl) args))
          model-name (first remaining-args)]
      (model-fn model-name options))))
