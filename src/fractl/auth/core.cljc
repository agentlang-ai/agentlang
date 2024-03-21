(ns fractl.auth.core)

(def service-tag :service)

(defmulti make-client service-tag)
;; Returns the function: `(fn [req token] (verify-and-extract token))`
;; The returned function is called every time an API request with Bearer token is received.
(defmulti make-authfn service-tag)
(defmulti user-login service-tag)
(defmulti verify-token service-tag)
;; Return user details that you want to attach in EventContext. 
;; Include `username` and `sub`.
(defmulti session-user service-tag)
;; Can be same as `session-user`.
(defmulti session-sub service-tag)
;; Logout from the auth broker and return some truthy value.
(defmulti user-logout service-tag)

;; Authenticate with a locally cached session-cookie.
;; If no session-cookie is found, redirect to an auth-uri.
(defmulti authenticate-session service-tag)

;; Handle the redirect-uri from an external auth-endpoint.
(defmulti handle-auth-callback service-tag)

;; Get user details
(defmulti get-user service-tag)
(defmulti resend-confirmation-code service-tag)
(defmulti confirm-sign-up service-tag)
(defmulti upsert-user service-tag)
(defmulti delete-user service-tag)
(defmulti forgot-password service-tag)
(defmulti confirm-forgot-password service-tag)
(defmulti change-password service-tag)
(defmulti refresh-token service-tag)
(defmulti create-role service-tag)
(defmulti delete-role service-tag)
(defmulti add-user-to-role service-tag)
(defmulti remove-user-from-role service-tag)

(def client-key :client)
(def instance-key :instance)
(def operation-type :operation)

(defn call-upsert-user
  ([client arg action user-inst]
   (upsert-user (assoc arg client-key client instance-key user-inst operation-type action)))
  ([client arg user-inst]
   (upsert-user (assoc arg client-key client instance-key user-inst operation-type :create))))

(defn call-delete-user [client arg user-inst]
  (delete-user (assoc arg client-key client instance-key user-inst)))

(defn service? [tag config]
  (let [s (:service config)]
    (= tag s)))

(def okta? (partial service? :okta))
(def cognito? (partial service? :cognito))
