(ns fractl.http
  (:require [amazonica.aws.s3 :as s3]
            [buddy.auth :as buddy]
            [buddy.auth.backends :as buddy-back]
            [buddy.auth.middleware :refer [wrap-authentication]]
            [buddy.sign.jwt :as buddyjwt]
            [clj-time.core :as time]
            [clojure.string :as str]
            [clojure.string :as s]
            [clojure.walk :as w]
            [fractl.auth.core :as auth]
            [fractl.auth.jwt :as jwt]
            [fractl.compiler :as compiler]
            [fractl.component :as cn]
            [fractl.evaluator :as ev]
            [fractl.global-state :as gs]
            [fractl.gpt.core :as gpt]
            [fractl.graphql.generator :as gg]
            [fractl.lang :as ln]
            [fractl.lang.internal :as li]
            [fractl.lang.raw :as lr]
            [fractl.paths.internal :as pi]
            [fractl.user-session :as sess]
            [fractl.util :as u]
            [fractl.util.errors :refer [get-internal-error-message]]
            [fractl.util.hash :as hash]
            [fractl.util.http :as uh]
            [fractl.util.logger :as log]
            [org.httpkit.server :as h]
            [org.httpkit.client :as hc]
            [fractl.datafmt.json :as json]
            [ring.util.codec :as codec]
            [ring.middleware.cors :as cors]
            [fractl.util.errors :refer [get-internal-error-message]]
            [fractl.evaluator :as ev]
            [com.walmartlabs.lacinia :refer [execute]]
            [fractl.graphql.core :as graphql])
  (:use [compojure.core :only [DELETE GET POST PUT routes]]
        [compojure.route :only [not-found]]))

(def core-component (atom ""))
(def graphql-schema (atom {}))
(def contains-graph (atom {}))
(def graphql-entity-metas (atom {}))

(defn- headers
  ([data-fmt]
   (merge
    (when data-fmt
      {"Content-Type" (uh/content-type data-fmt)}
      {"Access-Control-Allow-Origin" "*"
       "Access-Control-Allow-Methods" "GET,POST,PUT,DELETE"
       "Access-Control-Allow-Headers" "X-Requested-With,Content-Type,Cache-Control,Origin,Accept,Authorization"})))
  ([] (headers nil)))

(defn- response
  "Create a Ring response from a map object and an HTTP status code.
   The map object will be encoded as JSON in the response.
   Also see: https://github.com/ring-clojure/ring/wiki/Creating-responses"
  [json-obj status data-fmt]
  {:status status
   :headers {"Content-Type" (uh/content-type data-fmt)
             "Access-Control-Allow-Origin" "*"
             "Access-Control-Allow-Methods" "GET,POST,PUT,DELETE"
             "Access-Control-Allow-Headers" "X-Requested-With,Content-Type,Cache-Control,Origin,Accept,Authorization"}
   :body ((uh/encoder data-fmt) json-obj)})

(defn- unauthorized
  ([msg data-fmt errtype]
   (response {:reason msg :type errtype} 401 data-fmt))
  ([data-fmt errtype]
   (unauthorized "not authorized to access this resource" data-fmt errtype))
  ([data-fmt]
   (unauthorized "not authorized to access this resource" data-fmt "UNAUTHORIZED")))

(defn- bad-request
  ([s data-fmt errtype]
   (response {:reason s :type errtype} 400 data-fmt))
  ([s errtype] (bad-request s :json errtype))
  ([s] (bad-request s :json "BAD_REQUEST")))

(defn- internal-error
  "Logs errors and constructs client-side response based on the type of input."
  ([s data-fmt]
   (log/warn (str "internal error reported from HTTP layer: " s))
   (cond
     (string? s) (response {:reason s} 500 data-fmt)
     :else (response s 500 data-fmt)))
  ([s] (internal-error s :json)))

(defn- redirect-found [location cookie]
  {:status 302
   :headers
   (let [hdrs (assoc (headers) "Location" location)]
     (if cookie
       (let [cookie-domain (get-in (gs/get-app-config) [:authentication :cookie-domain])]
         (assoc hdrs "Set-Cookie" (str cookie "; Domain=" cookie-domain "; Path=/")))
       hdrs))})

(defn- sanitize-secrets [obj]
  (let [r (mapv (fn [[k v]]
                  [k (if (hash/crypto-hash? v)
                       "*********"
                       v)])
                obj)]
    (into {} r)))

(defn- cleanup-inst [obj]
  (cond
    (cn/an-instance? obj)
    (let [r (cn/instance-attributes (sanitize-secrets obj))]
      (into {} (mapv (fn [[k v]] [k (if (or (map? v) (vector? v))
                                      (cleanup-inst v)
                                      v)])
                     r)))
    (vector? obj) (mapv cleanup-inst obj)
    :else obj))

(defn- maybe-assoc-root-type [mode obj result]
  (if-let [t
           (case mode
             :single (cn/instance-type-kw obj)
             :seq (cn/instance-type-kw (first obj))
             nil)]
    (assoc result :type t)
    result))

(defn- cleanup-result [rs]
  (if-let [result (:result rs)]
    (let [mode (cond
                 (cn/an-instance? result) :single
                 (and (seqable? result) (seq result) (cn/an-instance? (first result))) :seq
                 :else :none)]
      (maybe-assoc-root-type
       mode result
       (assoc rs :result (case mode
                           :single (cleanup-inst result)
                           :seq (mapv cleanup-inst result)
                           result))))
    rs))

(defn- cleanup-results [rs]
  (if (map? rs)
    (cleanup-result rs)
    (mapv cleanup-result rs)))

(defn- maybe-non-ok-result [rs]
  (if (map? rs)
    (case (:status rs)
      :ok 200
      :not-found 404
      :error 500
      ;; TODO: handle other cases, like :timeout
      500)
    (maybe-non-ok-result (first rs))))

(defn- ok
  ([obj data-fmt]
   (let [status (maybe-non-ok-result obj)]
     (response (cleanup-results obj) status data-fmt)))
  ([obj]
   (ok obj :json)))

(defn- ok-html [body]
  {:status 200
   :body body
   :headers {"Content-Type" "text/html"
             "Content-Length" (count body)}})

(defn- maybe-remove-read-only-attributes [obj]
  (if (cn/an-instance? obj)
    (cn/dissoc-write-only obj)
    obj))

(defn- remove-all-read-only-attributes [obj]
  (w/prewalk maybe-remove-read-only-attributes obj))

(defn- evaluate [evaluator event-instance]
  (let [result (remove-all-read-only-attributes
                (evaluator event-instance))]
    result))

(defn- extract-status [r]
  (cond
    (map? r) (:status r)
    (vector? r) (extract-status (first r))
    :else nil))

(defn- wrap-result
  ([on-no-perm r data-fmt]
   (let [status (extract-status r)]
     (case status
       nil (bad-request "invalid request" data-fmt "NILL_REQUEST")
       :ok (ok (cleanup-results r) data-fmt)
       :error (if (gs/error-no-perm?)
                (if on-no-perm
                  (ok on-no-perm data-fmt)
                  (unauthorized r data-fmt "UNAUTHORIZED"))
                (internal-error r data-fmt))
       (ok r data-fmt))))
  ([r data-fmt]
   (wrap-result nil r data-fmt)))

(defn- maybe-ok
  ([on-no-perm exp data-fmt]
   (try
     (let [r (exp)]
       (wrap-result on-no-perm r data-fmt))
     (catch Exception ex
       (log/exception ex)
       (internal-error (.getMessage ex) data-fmt))))
  ([exp data-fmt]
   (maybe-ok nil exp data-fmt)))

(defn- assoc-event-context [request auth-config event-instance]
  (if auth-config
    (let [user (auth/session-user (assoc auth-config :request request
                                         :cookie (get (:headers request) "cookie")))
          event-instance (if (cn/an-instance? event-instance)
                           event-instance
                           (cn/make-instance event-instance))]
      (cn/assoc-event-context-values
       {:User (:email user)
        :Sub (:sub user)
        :UserDetails user}
       event-instance))
    event-instance))

(defn- event-from-request [request event-name data-fmt auth-config]
  (try
    (let [body (:body request)
          obj (if (map? body)
                body
                ((uh/decoder data-fmt)
                 (String.
                  (.bytes body)
                  java.nio.charset.StandardCharsets/UTF_8)))
          obj-name (li/split-path
                    (or (cn/instance-type obj)
                        (u/string-as-keyword
                         (first (keys obj)))))
          event-instance (if (cn/an-instance? obj)
                           obj
                           (cn/make-event-instance obj-name (first (vals obj))))]
      (if (or (not event-name) (= obj-name event-name))
        [(assoc-event-context request auth-config event-instance) nil]
        [nil (str "Type mismatch in request - " event-name " <> " obj-name)]))
    (catch Exception ex
      (log/exception ex)
      [nil (str "Failed to parse request - " (.getMessage ex))])))

(defn- request-content-type [request]
  (s/lower-case
   (or (get-in request [:headers "content-type"])
       "application/json")))

(defn- find-data-format [request]
  (let [ct (request-content-type request)]
    (uh/content-types ct)))

(defn- filter-request-for-logging [request]
  (let [r0 (dissoc request :body :async-channel)]
    (assoc r0 :headers (dissoc (:headers request) :cookie))))

(defmacro log-request [msg request]
  `(log/info (str ~msg " - " (filter-request-for-logging ~request))))

(defn- process-dynamic-eval
  ([evaluator [auth-config maybe-unauth] event-name request]
   (log-request (str "HTTP request received to process event " event-name) request)
   (or (maybe-unauth request)
       (if-let [data-fmt (find-data-format request)]
         (let [[obj err] (event-from-request request event-name data-fmt auth-config)]
           (if err
             (bad-request err data-fmt "EVENT_INVOKE_ERROR")
             (if (cn/an-internal-event? (cn/instance-type-kw obj))
               (bad-request
                (str "cannot invoke internal event - " (cn/instance-type-kw obj))
                data-fmt "INTERNAL_EVENT_ERROR")
               (maybe-ok #(evaluate evaluator obj) data-fmt))))
         (bad-request
          (str "unsupported content-type in request - "
               (request-content-type request)) "UNSUPPORTED_ERROR"))))
  ([evaluator auth-info request]
   (process-dynamic-eval evaluator auth-info nil request)))

(defn process-request [evaluator auth request]
  (let [params (:params request)
        component (keyword (:component params))
        event (keyword (:event params))
        n [component event]]
    (if (cn/find-event-schema n)
      (process-dynamic-eval evaluator auth n request)
      (bad-request (str "Event not found - " n) "NOT_FOUND"))))

(defn- paths-info [component]
  (mapv (fn [n] {(subs (str n) 1)
                 {"post" {"parameters" (cn/encode-expressions-in-schema (cn/event-schema n))}}})
        (cn/event-names component)))

(defn- request-object [request]
  (if-let [data-fmt (find-data-format request)]
    [(when-let [body (:body request)]
       ((uh/decoder data-fmt) (String. (.bytes body)))) data-fmt nil]
    [nil nil (bad-request (str "unsupported content-type in request - " (request-content-type request)) "UNSUPPORTED_CONTENT")]))

(defn- process-meta-request [[_ maybe-unauth] request]
  (or (maybe-unauth request)
      (let [params (:params request)]
        (if-not (seq params)
          (ok {:components (cn/component-names)})
          (let [c (keyword (:component params))]
            (ok {:paths (paths-info c)
                 :schema (cn/schema-info c)
                 :component-edn (str (vec (rest (lr/as-edn c))))}))))))

(defn- process-gpt-chat [[_ maybe-unauth] request]
  (or (maybe-unauth request)
      (let [[map-obj _ err-response] (request-object request)]
        (or err-response
            (let [resp (atom nil)
                  type-obj (get map-obj :type)
                  gpt-model (get map-obj :model)
                  open-ai-key (get map-obj :key)
                  request-message (get map-obj :message)
                  result-tuning (get map-obj :result-tuning)
                  generation (gpt/non-interactive-generate
                               (if (nil? type-obj)
                                 "model"
                                 type-obj)
                               gpt-model
                               open-ai-key
                               (fn [choice history]
                                 (if choice
                                   (reset!
                                     resp
                                     {:choice       choice
                                      :chat-history history})
                                   (u/throw-ex "AI failed to service your request, please try again")))
                               request-message
                               result-tuning)]
              (reset! resp generation)
              (ok @resp))))))

(defn- parse-rest-uri [request]
  (try
    (let [s (:* (:params request))
          [uri suffix] (if (s/ends-with? s "/__tree")
                         [(subs s 0 (s/index-of s "/__tree")) :tree]
                         [s nil])]
      (assoc (uh/parse-rest-uri uri) :suffix suffix))
    (catch Exception ex
      (log/warn (str "failed to parse uri: " (.getMessage ex))))))

(defn- maybe-path-attribute [path]
  (when path
    {li/path-attr path}))

(defn- process-generic-request [handler evaluator [auth-config maybe-unauth] request]
  (log-request "Processing HTTP request" request)
  (or (maybe-unauth request)
      (if-let [parsed-path (parse-rest-uri request)]
        (let [query-params (when-let [s (:query-string request)] (uh/form-decode s))
              [obj data-fmt err-response] (request-object request)
              parsed-path (assoc parsed-path :query-params query-params :data-fmt data-fmt)]
          (or err-response (let [[event-gen resp options] (handler parsed-path obj)]
                             (if resp
                               resp
                               (let [[evt post-fn] (if (fn? event-gen) (event-gen) [event-gen nil])
                                     evt (assoc-event-context request auth-config evt)]
                                 (try
                                   (maybe-ok
                                    (and options (:on-no-perm options))
                                    #(evaluate evaluator evt) data-fmt)
                                   (finally
                                     (when post-fn (post-fn)))))))))
        (bad-request (str "invalid request uri - " (:* (:params request))) "INVALID_REQUEST_URI"))))

(defn- multi-post-request? [obj]
  (>= (count (keys obj)) 2))

(defn- maybe-generate-multi-post-event [obj component path-attr]
  (when (multi-post-request? obj)
    (let [event-name (li/temp-event-name component)]
      (and (apply ln/dataflow event-name (compiler/parse-relationship-tree path-attr obj))
           event-name))))

(def process-post-request
  (partial
   process-generic-request
   (fn [{entity-name :entity component :component path :path} obj]
     (let [path-attr (when path {li/path-attr (pi/as-partial-path path)})]
       (if (cn/event? entity-name)
         [obj nil]
         (if-let [evt (maybe-generate-multi-post-event obj component path-attr)]
           [(fn [] [{evt {}} #(cn/remove-event evt)]) nil]
           [{(cn/crud-event-name component entity-name :Create)
             (merge {:Instance obj} path-attr)}
            nil]))))))

(def process-put-request
  (partial
   process-generic-request
   (fn [{entity-name :entity id :id component :component path :path} obj]
     (if-not (or id path)
       [nil (bad-request (str "id or path required to update " entity-name) "UPDATE_FAILED")]
       [{(cn/crud-event-name component entity-name :Update)
         (merge
          (when-not path
            (let [id-attr (cn/identity-attribute-name entity-name)]
              {id-attr (cn/parse-attribute-value entity-name id-attr id)}))
          {:Data (li/record-attributes obj)}
          (maybe-path-attribute path))}
        nil]))))

(defn- generate-filter-query-event
  ([component entity-name query-params deleted]
   (let [event-name (li/temp-event-name component)]
     (and (apply ln/dataflow
                 event-name [{(li/name-as-query-pattern entity-name)
                              (merge
                               (when deleted {:deleted true})
                               {:where
                                (if (map? query-params)
                                  `[:and ~@(mapv
                                            (fn [[k v]]
                                              [(if (= k li/path-attr) :like :=)
                                               k (cn/parse-attribute-value entity-name k v)])
                                            query-params)]
                                  query-params)})}])
          event-name)))
  ([component entity-name query-params]
   (generate-filter-query-event component entity-name query-params false)))

(defn- make-lookup-event [component entity-name id path]
  {(cn/crud-event-name component entity-name :Lookup)
   (merge
    (when-not path
      (let [id-attr (cn/identity-attribute-name entity-name)]
        {id-attr (cn/parse-attribute-value entity-name id-attr id)}))
    (maybe-path-attribute path))})

(defn- make-lookupall-event [component entity-name path]
  {(cn/crud-event-name component entity-name :LookupAll)
   (or (when path (maybe-path-attribute path)) {})})

(declare maybe-merge-child-uris)

(defn- merge-child-uris [evaluator evt-context data-fmt
                         component entity-name
                         parent-insts children]
  (mapv (fn [r]
          (reduce
           (fn [parent-inst [relname _ child-entity]]
             (let [[c n] (li/split-path child-entity)
                   path (cn/full-path-from-references parent-inst relname child-entity)
                   evt (evt-context (make-lookupall-event c child-entity path))
                   rs (let [rs (evaluate evaluator evt)]
                        (if (map? rs) rs (first rs)))]
               (if (= :ok (:status rs))
                 (let [result (maybe-merge-child-uris
                               evaluator evt-context data-fmt
                               c child-entity (cleanup-inst (:result rs)))
                       rels (li/rel-tag parent-inst)]
                   (assoc parent-inst li/rel-tag (assoc rels relname result)))
                 parent-inst)))
           r children))
        parent-insts))

(defn- maybe-merge-child-uris [evaluator evt-context data-fmt component entity-name insts]
  (if-let [children (seq (cn/contained-children entity-name))]
    (merge-child-uris evaluator evt-context data-fmt component entity-name insts children)
    insts))

(defn- get-tree [evaluator [auth-config maybe-unauth] request
                 component entity-name id path data-fmt]
  (if-not id
    (bad-request (str "identity of " entity-name " required for tree lookup") "IDENTITY_REQUIRED")
    (or (maybe-unauth request)
        (let [evt-context (partial assoc-event-context request auth-config)
              evt (evt-context (make-lookup-event component entity-name id path))
              rs (let [rs (evaluate evaluator evt)]
                   (if (map? rs) rs (first rs)))
              status (extract-status rs)]
          (if (= :ok status)
            (let [result (cleanup-inst (:result rs))]
              (if (seq result)
                (ok (maybe-merge-child-uris
                     evaluator evt-context data-fmt
                     component entity-name result)
                    data-fmt)
                (ok result data-fmt)))
            (wrap-result rs data-fmt))))))

(defn- between-rel-path? [path]
  (when path
    (when-let [p (first (take-last 2 (pi/uri-path-split path)))]
      (cn/between-relationship? (pi/decode-uri-path-part p)))))

(defn- generate-query-by-between-rel-event [component path]
  (let [parts (pi/uri-path-split path)
        relname (pi/decode-uri-path-part (first (take-last 2 parts)))
        query-entity (pi/decode-uri-path-part (last parts))
        entity-name (pi/decode-uri-path-part (first (take-last 4 parts)))
        event-name (li/temp-event-name component)
        pats (if (= 4 (count parts))
               (let [id (get parts 1)]
                 [{(li/name-as-query-pattern query-entity) {}
                   :-> [[{relname {(li/name-as-query-pattern
                                    (first (cn/find-between-keys relname entity-name))) id}}]]}])
               (let [alias (li/unq-name)
                     id (li/make-ref alias li/id-attr)]
                 [{entity-name
                   {li/path-attr? (pi/uri-join-parts (drop-last 2 parts))}
                   :as [alias]}
                  {(li/name-as-query-pattern query-entity) {}
                   :-> [[{relname {(li/name-as-query-pattern
                                    (first (cn/find-between-keys relname entity-name))) id}}]]}]))]
    (when (apply ln/dataflow event-name pats)
      event-name)))

(defn process-get-request [evaluator auth-info request]
  (process-generic-request
   (fn [{entity-name :entity id :id component :component path :path
         suffix :suffix query-params :query-params data-fmt :data-fmt
         :as p} obj]
     (cond
       query-params
       [(fn []
          (let [evt (generate-filter-query-event
                     component entity-name
                     (merge query-params (when path (maybe-path-attribute (str path "%")))))]
            [{evt {}} #(cn/remove-event evt)]))
        nil]

       (= suffix :tree)
       [nil (get-tree evaluator auth-info request component
                      entity-name id path data-fmt)]

       (between-rel-path? path)
       [(fn []
          (let [evt (generate-query-by-between-rel-event component path)]
            [{evt {}} #(cn/remove-event evt)]))
        nil]

       :else
       [(if id
          (make-lookup-event component entity-name id path)
          (make-lookupall-event component entity-name (when path (str path "%"))))
        nil (when-not id {:on-no-perm []})]))
   evaluator auth-info request))

(def process-delete-request
  (partial
   process-generic-request
   (fn [{entity-name :entity id :id component :component path :path} _]
     (if-not (or id path)
       [nil (bad-request (str "id or path required to delete " entity-name) "ID_PATH_REQUIRED")]
       [{(cn/crud-event-name component entity-name :Delete)
         (merge
          (when-not path
            (let [id-attr (cn/identity-attribute-name entity-name)]
              {id-attr (cn/parse-attribute-value entity-name id-attr id)}))
          (maybe-path-attribute path))}
        nil]))))

(defn- like-pattern? [x]
  ;; For patterns that include the `_` wildcard,
  ;; the caller should provide an explicit where clause:
  ;;  {:from :EntityName
  ;;   :where [:like :AttributeName "pattern%"]}
  (and (string? x)
       (s/includes? x "%")))

(defn- filter-as-where-clause [[k v]]
  (let [n (u/string-as-keyword k)]
    (cond
      (vector? v) [(u/string-as-keyword (first v))
                   n (second v)]
      (like-pattern? v) [:like n v]
      :else [:= n v])))

(defn- preprocess-query [q]
  (if-let [fls (:filters q)]
    (let [or-cond (:or fls)
          f (or or-cond fls)]
      (assoc
       (dissoc q :filters)
       :where
       (let [r (mapv filter-as-where-clause f)]
         (if (= 1 (count r))
           (first r)
           `[~(if or-cond :or :and) ~@r]))))
    q))

(defn- process-query [evaluator [auth-config maybe-unauth] request]
  (log-request "Processing HTTP query request" request)
  (or (maybe-unauth request)
      (if-let [data-fmt (find-data-format request)]
        (let [reqobj ((uh/decoder data-fmt) (String. (.bytes (:body request))))
              qobj (:Query reqobj)
              q (preprocess-query qobj)
              deleted (:deleted qobj)
              entity-name (:from q)
              [component _] (li/split-path entity-name)
              evn (generate-filter-query-event component entity-name (:where q) deleted)
              evt (assoc-event-context request auth-config {evn {}})]
          (try
            (maybe-ok #(evaluate evaluator evt) data-fmt)
            (catch Exception ex
              (log/exception ex)
              (internal-error (get-internal-error-message :query-failure (.getMessage ex))))
            (finally (cn/remove-event evn))))
        (bad-request (str "unsupported content-type in request - "
                          (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-start-debug-session [evaluator [auth-config maybe-unauth] request]
  (log-request "Start debug request received" request)
  (or (maybe-unauth request)
      (if-let [data-fmt (find-data-format request)]
        (let [[obj _ err-response] (request-object request)]
          (or err-response
              (ok-html (ev/debug-dataflow obj))))
        (bad-request (str "unsupported content-type in request - "
                          (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-debug-step [evaluator [auth-config maybe-unauth] request]
  (log-request "Debug-step request received" request)
  (or (maybe-unauth request)
      (let [id (get-in request [:params :id])]
        (ok (ev/debug-step id)))))

(defn- process-debug-continue [evaluator [auth-config maybe-unauth] request]
  (log-request "Debug-continue request received" request)
  (or (maybe-unauth request)
      (let [id (get-in request [:params :id])]
        (ok (ev/debug-continue id)))))

(defn- process-delete-debug-session [evaluator [auth-config maybe-unauth] request]
  (log-request "Debug-delete request received" request)
  (or (maybe-unauth request)
      (let [id (get-in request [:params :id])]
        (ok (ev/debug-cancel id)))))

(defn- eval-ok-result [eval-result]
  (if (vector? eval-result)
    (eval-ok-result (first eval-result))
    (when (and (map? eval-result) (= :ok (:status eval-result)))
      (:result eval-result))))

(defn- eval-result [eval-res]
  (if (vector? eval-res)
    (eval-result (first eval-res))
    eval-res))

;; TODO: Add layer of domain filtering on top of cognito.
(defn- whitelisted-email? [email]
  (let [{:keys [access-key secret-key region whitelist?] :as _aws-config} (uh/get-aws-config)]
    (if (true? whitelist?)
      (let [{:keys [s3-bucket whitelist-file-key]} _aws-config
            whitelisted-emails (read-string
                                (s3/get-object-as-string
                                 {:access-key access-key
                                  :secret-key secret-key
                                  :endpoint region}
                                 s3-bucket whitelist-file-key))]
        (contains? whitelisted-emails email))
      nil)))

;; TODO: Add layer of domain filtering on top of cognito.
(defn- whitelisted-domain? [email domains]
  (let [domain (last (s/split email #"@"))]
    (contains? (set domains) domain)))

(defn- whitelisted? [email {:keys [whitelist? email-domains] :as _auth-info}]
  ;; TODO: Add layer of domain filtering on top of cognito.
  (cond
    (and (not (nil? email-domains)) (true? whitelist?))
    (whitelisted-domain? email email-domains)

    (true? whitelist?)
    (whitelisted-email? email)

    :else
    true))

(defn- get-signup-error-message [ex]
  (let [message (.getMessage ex)]
    (cond
      (re-find #"duplicate key value" message)
      ["A user with the provided email already exists." "ALREADY_EXISTS"]
      (re-find #"Password did not conform" message)
      ["Password does not conform to the specification. Please choose a stronger password." "INVALID_PASSWORD"]
      :else [message "SIGNUP_ERROR"])))

(defn- create-event [event-name]
  {cn/type-tag-key :event
   cn/instance-type (keyword event-name)})

(defn- process-signup [evaluator call-post-signup [auth-config _] request]
  (log-request "Signup request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "sign-up"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad sign-up request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/SignUp evobj))
          (bad-request (str "not a signup event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (if-not (whitelisted? (:Email (:User evobj)) auth-config)
            (unauthorized "Your email is not whitelisted yet." data-fmt "NOT_WHITELISTED")
            (try
              (let [result (evaluate evaluator evobj)
                    r (eval-ok-result result)]
                (when (not r) (throw (Exception. (:message (eval-result result)))))
                (let [user (if (map? r) r (first r))
                      post-signup-result
                      (when call-post-signup
                        (evaluate
                         evaluator
                         (assoc
                          (create-event :Fractl.Kernel.Identity/PostSignUp)
                          :SignupResult result :SignupRequest evobj)))]
                  (if user
                    (ok (or (when (seq post-signup-result) post-signup-result)
                            {:status :ok :result (dissoc user :Password)}) data-fmt)
                    (bad-request (or post-signup-result result) data-fmt "POST_SIGNUP_FAILED"))))
              (catch Exception ex
                (log/warn ex)
                (let [[message errtype] (get-signup-error-message ex)]
                  (unauthorized (str "Sign up failed. " message)
                                data-fmt errtype)))))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn decode-jwt-token-from-response [response]
  (let [res (:authentication-result response)
        token (or (:access-token res) (:id-token res))]
    (jwt/decode token)))

(defn- attach-set-cookie-header [resp cookie]
  (let [hdrs (:headers resp)]
    (assoc resp :headers (assoc hdrs "Set-Cookie" cookie))))

(defn- process-login [evaluator [auth-config _ :as _auth-info] request]
  (log-request "Login request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "login"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (if err
          (do (log/warn (str "bad login request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))
          (try
            (let [result (auth/user-login
                          (assoc
                           auth-config
                           :event evobj
                           :eval evaluator))
                  user-id (get (decode-jwt-token-from-response result) :sub)
                  cookie (get-in result [:authentication-result :user-data :cookie])
                  resp (ok {:result (if cookie {:authentication-result :success} result)} data-fmt)]
              (sess/upsert-user-session user-id true)
              (if cookie
                (do (sess/session-cookie-create cookie result)
                    (attach-set-cookie-header resp cookie))
                resp))
            (catch Exception ex
              (log/warn ex)
              (unauthorized
               (str "Login failed. "
                    (.getMessage ex)) data-fmt "LOGIN_ERROR")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-resend-confirmation-code [auth-config request]
  (log-request "Resend confirmation code request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "resend-confirmation-code"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad resend-confirmation-code request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/ResendConfirmationCode evobj))
          (bad-request (str "not a resend-confirmation event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [result (auth/resend-confirmation-code
                          (assoc
                           auth-config
                           :event evobj))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "Resending confirmation code failed. "
                                 (.getMessage ex)) data-fmt "RESEND_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-confirm-sign-up [auth-config request]
  (log-request "Confirm-signup request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "process-confirm-sign-up"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad confirm-sign-up request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/ConfirmSignUp evobj))
          (bad-request (str "not a confirm-sign-up event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [result (auth/confirm-sign-up
                          (assoc
                           auth-config
                           :event evobj))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "Verify user failed. "
                                 (.getMessage ex)) data-fmt "CONFIRM_SIGNUP_ERROR")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-forgot-password [auth-config request]
  (log-request "Forgot-password request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "forgot-password"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad forgot-request request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/ForgotPassword evobj))
          (bad-request (str "not a forgot-password event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [result (auth/forgot-password
                          (assoc
                           auth-config
                           :event evobj))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "Forgot Password failed. "
                                 (.getMessage ex)) data-fmt "FORGET_PASSWORD_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-confirm-forgot-password [auth-config request]
  (log-request "Confirm-forgot-password request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "confirm-forgot-password"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad confirm-forgot-request request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/ConfirmForgotPassword evobj))
          (bad-request (str "not a confirm-forgot-password event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [result (auth/confirm-forgot-password
                          (assoc
                           auth-config
                           :event evobj))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "Confirm Forgot Password failed. "
                                 (.getMessage ex)) data-fmt "CONFIRM_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-change-password [auth-config request]
  (log-request "Change-password request received" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "change-password"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request nil data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad change-password-request request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/ChangePassword evobj))
          (bad-request (str "not a change-password event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [result (auth/change-password
                          (assoc
                           auth-config
                           :event evobj))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "Change Password failed. "
                                 (.getMessage ex)) data-fmt "CHANGE_PASSWORD_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - "
            (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-logout [auth-config request]
  (log-request "Logout request received" request)
  (if-let [data-fmt (find-data-format request)]
    (if auth-config
      (try
        (let [ac (assoc auth-config :request request)
              cookie (get (:headers request) "cookie")
              auth-config (if cookie
                            (assoc ac :cookie [cookie (sess/lookup-session-cookie-user-data cookie)])
                            ac)
              sub (auth/session-sub auth-config)
              result (auth/user-logout (assoc auth-config :sub sub))]
          (sess/upsert-user-session (:username sub) false)
          (when cookie
            (when-not (sess/session-cookie-delete cookie)
              (log/warn (str "session-cookie not deleted for " cookie))))
          (ok {:result result} data-fmt))
        (catch Exception ex
          (log/warn ex)
          (unauthorized (str "logout failed. " (ex-message ex)) data-fmt "LOGOUT_FAILED")))
      (ok {:result :bye} data-fmt))
    (bad-request
     (str "unsupported content-type in request - "
          (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE")))

(defn- process-get-user [auth-config request]
  (log-request "Get-user request" request)
  (if-let [data-fmt (find-data-format request)]
    (if auth-config
      (try
        (let [user (auth/session-user
                    (assoc auth-config :request request))
              result (auth/get-user
                      (assoc auth-config :user user))]
          (ok {:result result} data-fmt))
        (catch Exception ex
          (log/warn ex)
          (unauthorized (str "get-user failed" (ex-message ex)) data-fmt "GET_USER_FAILED")))
      (unauthorized "get-user failed" data-fmt "GET_USER_FAILED"))
    (bad-request
     (str "unsupported content-type in request - "
          (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE")))

(defn- process-update-user [auth-config request]
  (log-request "Update-user request" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "update-user"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request [:Fractl.Kernel.Identity :UpdateUser] data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad update-user request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/UpdateUser evobj))
          (bad-request (str "not a UpdateUser event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [user (auth/session-user
                        (assoc auth-config :request request))
                  result (auth/upsert-user
                          (assoc
                           auth-config
                           :instance evobj
                           :user user))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "update-user failed. " (ex-message ex)) data-fmt "UPDATE_USER_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - " (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- process-refresh-token [auth-config request]
  (log-request "Refresh-token request" request)
  (if-not auth-config
    (internal-error (get-internal-error-message :auth-disabled "refresh-token"))
    (if-let [data-fmt (find-data-format request)]
      (let [[evobj err] (event-from-request request [:Fractl.Kernel.Identity :RefreshToken] data-fmt nil)]
        (cond
          err
          (do (log/warn (str "bad refresh-token request - " err))
              (bad-request err data-fmt "BAD_REQUEST_FORMAT"))

          (not (cn/instance-of? :Fractl.Kernel.Identity/RefreshToken evobj))
          (bad-request (str "not a RefreshToken event - " evobj) data-fmt "BAD_REQUEST_FORMAT")

          :else
          (try
            (let [user (auth/session-user
                        (assoc auth-config :request request))
                  result (auth/refresh-token
                          (assoc
                           auth-config
                           :event evobj
                           :user user))]
              (ok {:result result} data-fmt))
            (catch Exception ex
              (log/warn ex)
              (unauthorized (str "refresh-token failed. " (ex-message ex)) data-fmt "REFRESH_TOKEN_FAILED")))))
      (bad-request
       (str "unsupported content-type in request - " (request-content-type request)) "UNSUPPORTED_CONTENT_TYPE"))))

(defn- auth-response [result]
  (case (:status result)
    :redirect-found (redirect-found (:location result) (:set-cookie result))
    :ok (ok (:message result))
    (bad-request (:error result))))

(defn- process-auth [evaluator [auth-config _] request]
  (log-request "Auth request" request)
  (let [cookie (get-in request [:headers "cookie"])
        query-params (when-let [s (:query-string request)] (uh/form-decode s))]
    (auth-response
     (auth/authenticate-session (assoc auth-config :cookie cookie :client-url (:origin query-params))))))

(defn- process-auth-callback [evaluator call-post-signup [auth-config _] request]
  (log-request "Auth-callback request" request)
  (auth-response
   (auth/handle-auth-callback
    (assoc auth-config :args {:evaluate evaluate
                              :evaluator evaluator
                              :call-post-signup call-post-signup
                              :request request}))))

(defn- make-magic-link [username op payload description expiry]
  (let [hskey (u/getenv "FRACTL_HS256_KEY")]
    (buddyjwt/sign {:username username :operation op
                    :payload payload :description description
                    :exp (time/plus (time/now) (time/seconds expiry))}
                   hskey)))

(defn- decode-magic-link-token [token]
  (let [hskey (u/getenv "FRACTL_HS256_KEY")]
    (buddyjwt/unsign token hskey)))

(defn- process-register-magiclink [[auth-config _] auth request]
  (log-request "Register-magiclink request" request)
  (if auth-config
    (let [[obj _ _] (request-object request)
          sub (auth/session-sub
               (assoc auth :request request))]
      (if-let [username (:email sub)]
        (if-let [op (:operation obj)]
          (if-let [payload (:payload obj)]
            (if-let [expiry (:expiry obj)]
              (let [code (make-magic-link username op payload (:description obj) expiry)]
                (ok {:status "ok" :code code}))
              (bad-request (str "expiry date required") "EXPIRY_DATE_REQUIRED"))
            (bad-request (str "payload required") "PAYLOAD_REQUIRED"))
          (bad-request (str "operation required") "OPERATION_REQUIRED"))
        (bad-request (str "authentication not valid") "INVALID_AUTHENTICATION")))
    (internal-error "cannot process register-magiclink - authentication not enabled")))

(defn- process-get-magiclink [_ request]
  (log-request "Get-magiclink request" request)
  (let [query (when-let [s (:query-string request)] (uh/form-decode s))]
    (if-let [token (:code query)]
      (let [decoded-token (decode-magic-link-token token)
            operation (:operation decoded-token)
            payload (:payload decoded-token)]
        (if (and operation payload)
          (let [result (ev/eval-all-dataflows (cn/make-instance {operation payload}))]
            (ok (dissoc (first result) :env)))
          (bad-request (str "bad token") "BAD_TOKEN")))
      (bad-request (str "token not specified") "ID_TOKEN_REQUIRED"))))

(defn- process-preview-magiclink [_ request]
  (log-request "Preview-magiclink request" request)
  (let [[obj _ _] (request-object request)]
    (if-let [token (:code obj)]
      (let [decoded-token (decode-magic-link-token token)]
        (ok {:status "ok" :result decoded-token}))
      (bad-request (str "token not specified") "ID_TOKEN_REQUIRED"))))

(defn- process-root-get [_]
  (ok {:result :fractl}))

(defn graphql-handler
  [[auth-config maybe-unauth] request]
  (if (not (empty? @graphql-schema))
    (or (maybe-unauth request)
          (let [body-as-string (slurp (:body request))
          body (json/decode body-as-string)
          query (:query body)
          variables (:variables body)
          operation-name (:operationName body)
          context {:request request :auth-config auth-config :core-component @core-component :contains-graph @contains-graph :entity-metas @graphql-entity-metas}
          result (execute @graphql-schema query variables context operation-name)]
      (response result 200 :json)))
    (response {:error "GraphQL schema compilation failed"} 500 :json)))

(defn- make-routes [config auth-config handlers]
  (let [r (routes
           (POST uh/graphql-prefix [] (:graphql handlers))
           (POST uh/login-prefix [] (:login handlers))
           (POST uh/logout-prefix [] (:logout handlers))
           (POST uh/signup-prefix [] (:signup handlers))
           (POST uh/confirm-sign-up-prefix [] (:confirm-sign-up handlers))
           (POST uh/get-user-prefix [] (:get-user handlers))
           (POST uh/update-user-prefix [] (:update-user handlers))
           (POST uh/forgot-password-prefix [] (:forgot-password handlers))
           (POST uh/confirm-forgot-password-prefix [] (:confirm-forgot-password handlers))
           (POST uh/change-password-prefix [] (:change-password handlers))
           (POST uh/refresh-token-prefix [] (:refresh-token handlers))
           (POST uh/resend-confirmation-code-prefix [] (:resend-confirmation-code handlers))
           (PUT (str uh/entity-event-prefix "*") [] (:put-request handlers))
           (POST (str uh/entity-event-prefix "*") [] (:post-request handlers))
           (GET (str uh/entity-event-prefix "*") [] (:get-request handlers))
           (DELETE (str uh/entity-event-prefix "*") [] (:delete-request handlers))
           (POST uh/debug-prefix [] (:start-debug-session handlers))
           (PUT (str uh/debug-prefix "/step/:id") [] (:debug-step handlers))
           (PUT (str uh/debug-prefix "/continue/:id") [] (:debug-continue handlers))
           (DELETE (str uh/debug-prefix "/:id") [] (:delete-debug-session handlers))
           (POST uh/query-prefix [] (:query handlers))
           (POST uh/dynamic-eval-prefix [] (:eval handlers))
           (POST uh/ai-prefix [] (:ai handlers))
           (GET uh/auth-prefix [] (:auth handlers))
           (GET uh/auth-callback-prefix [] (:auth-callback handlers))
           (POST uh/register-magiclink-prefix [] (:register-magiclink handlers))
           (GET uh/get-magiclink-prefix [] (:get-magiclink handlers))
           (POST uh/preview-magiclink-prefix [] (:preview-magiclink handlers))
           (GET "/meta" [] (:meta handlers))
           (GET "/meta/:component" [] (:meta handlers))
           (POST uh/post-inference-service-question [] (:post-inference-service-question handlers))
           (GET "/" [] process-root-get)
           (not-found "<p>Resource not found</p>"))
        r-with-auth (if auth-config
                      (wrap-authentication
                       r (buddy-back/token
                          {:authfn (auth/make-authfn auth-config)
                           :token-name "Bearer"}))
                      r)]
    (cors/wrap-cors
     r-with-auth
     :access-control-allow-origin (or (:cors-allow-origin config)
                                      [#".*"])
     :access-control-allow-credentials true
     :access-control-allow-methods [:post :put :delete :get])))

(defn- handle-request-auth [auth-config request]
  (try
    (if-let [user (get-in request [:identity :sub])]
      (when-not (and (buddy/authenticated? request)
                     (sess/is-logged-in user))
        (log-request "unauthorized request" request)
        (unauthorized (find-data-format request)))
      (let [cookie (get (:headers request) "cookie")
            sid (auth/cookie-to-session-id auth-config cookie)
            data (sess/lookup-session-cookie-user-data sid)
            user (:username (auth/verify-token auth-config [sid data]))]
        (when-not (sess/is-logged-in user)
          (log-request "unauthorized request" request)
          (unauthorized (find-data-format request)))))
    (catch Exception ex
      (log/warn ex)
      (unauthorized (find-data-format request)))))

(defn- auth-service-supported? [auth]
  (some #{(:service auth)} [:keycloak :cognito :okta :dataflow]))

(defn make-auth-handler [config]
  (let [auth (:authentication config)
        auth-check (if auth (partial handle-request-auth auth) (constantly false))]
    [auth auth-check]))

(defn run-server
  ([evaluator config]
   (let [core-component-name (first (cn/remove-internal-components (cn/component-names)))
         schema (cn/schema-info core-component-name)
         contains-graph-map (gg/generate-contains-graph schema)
         [auth _ :as auth-info] (make-auth-handler config)]
     (let [app-config (gs/get-app-config)
           graphql-enabled (get-in app-config [:graphql :enabled] true)]
       (when graphql-enabled
         (try
           ;; attempt to compile the GraphQL schema
           (let [[uninjected-graphql-schema injected-graphql-schema entity-metadatas]
                 (graphql/compile-graphql-schema schema contains-graph-map)]
             ;; save schema to global variable and file
             (graphql/save-schema uninjected-graphql-schema)
             (reset! core-component core-component-name)
             (reset! graphql-schema injected-graphql-schema)
             (reset! graphql-entity-metas entity-metadatas)
             (reset! contains-graph contains-graph-map)
             (log/info "GraphQL schema generation and resolver injection succeeded."))
           (catch Exception e
             (log/error (str "Failed to compile GraphQL schema:"
                             (str/join "\n" (.getStackTrace e))))))))
     (if (or (not auth) (auth-service-supported? auth))
       (let [config (merge {:port 8080 :thread (+ 1 (u/n-cpu))} config)]
         (println (str "The HTTP server is listening on port " (:port config)))
         (h/run-server
          (make-routes
           config auth
           {:graphql (partial graphql-handler auth-info)
            :login (partial process-login evaluator auth-info)
            :logout (partial process-logout auth)
            :signup (partial
                     process-signup evaluator
                     (:call-post-sign-up-event config) auth-info)
            :confirm-sign-up (partial process-confirm-sign-up auth)
            :get-user (partial process-get-user auth)
            :update-user (partial process-update-user auth)
            :forgot-password (partial process-forgot-password auth)
            :confirm-forgot-password (partial process-confirm-forgot-password auth)
            :change-password (partial process-change-password auth)
            :refresh-token (partial process-refresh-token auth)
            :resend-confirmation-code (partial process-resend-confirmation-code auth)
            :put-request (partial process-put-request evaluator auth-info)
            :post-request (partial process-post-request evaluator auth-info)
            :get-request (partial process-get-request evaluator auth-info)
            :delete-request (partial process-delete-request evaluator auth-info)
            :start-debug-session (partial process-start-debug-session evaluator auth-info)
            :debug-step (partial process-debug-step evaluator auth-info)
            :debug-continue (partial process-debug-continue evaluator auth-info)
            :delete-debug-session (partial process-delete-debug-session evaluator auth-info)
            :query (partial process-query evaluator auth-info)
            :eval (partial process-dynamic-eval evaluator auth-info nil)
            :ai (partial process-gpt-chat auth-info)
            :auth (partial process-auth evaluator auth-info)
            :auth-callback (partial
                            process-auth-callback evaluator
                            (:call-post-sign-up-event config) auth-info)
            :register-magiclink (partial process-register-magiclink auth-info auth)
            :get-magiclink (partial process-get-magiclink auth-info)
            :preview-magiclink (partial process-preview-magiclink auth-info)
            :meta (partial process-meta-request auth-info)})
          config))
       (u/throw-ex (str "authentication service not supported - " (:service auth))))))
  ([evaluator]
   (run-server evaluator {})))
