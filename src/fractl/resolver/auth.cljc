(ns fractl.resolver.auth
  "Authentication management"
  (:require [fractl.util :as u]
            [fractl.resolver.core :as r]
            [fractl.component :as cn]
            [fractl.lang.datetime :as dt])
  #?(:clj (:import [fractl.auth.auth0 Auth0AuthUtil])))

(def ^:private db (u/make-cell {}))

(defn- auth-kernel-auth-upsert [inst]
  #?(:clj
     (let [now (dt/now-raw)
           inst-with-issued
           (assoc inst :Issued now)]
       (u/call-and-set
        db
        #(assoc
          @db (:Id inst)
          inst-with-issued))
       (assoc inst :Issued (dt/as-string now)))))

(defn- auth-kernel-oauth2-upsert [inst]
  #?(:clj
     (let [now (dt/now-raw)
           authorizeUrl (Auth0AuthUtil/authorizeUrl (:ClientID inst)
                                                    (:ClientSecret inst)
                                                    (:AuthDomain inst)
                                                    (:CallbackURL inst)
                                                    (:AuthScope inst))        
           inst-with-generated
           (assoc inst :Generated now :AuthorizeURL authorizeUrl)]
       (u/call-and-set
        db
        #(assoc
          @db (:Id inst)
          inst-with-generated))
       (assoc inst :Generated (dt/as-string now) :AuthorizeURL authorizeUrl))))

(defn auth-upsert [inst]
  (cond
    (cn/instance-of? :Kernel/Authentication inst) (auth-kernel-auth-upsert inst)
    (cn/instance-of? :Kernel/OAuth2Request inst) (auth-kernel-oauth2-upsert inst)))

(defn- auth-delete [inst]
  (let [id (:Id inst)]
    (u/call-and-set
     db
     #(dissoc @db id))
    id))

(defn auth-query [id]
  (when-let [inst (get @db id)]
    (if (> (:ExpirySeconds inst)
           (dt/difference-in-seconds
            (:Issued inst) (dt/now-raw)))
      inst
      (do (auth-delete {:Id id})
          nil))))

(def ^:private resolver-fns
  {:upsert {:handler auth-upsert}
   :delete {:handler auth-delete}
   :query {:handler auth-query}})

(defn make
  "Create and return a policy resolver"
  [resolver-name config]
  (r/make-resolver resolver-name resolver-fns))
