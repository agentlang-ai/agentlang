(ns fractl.store.protocol
  (:require [fractl.util :as u]))

(defn- not-implemented [method]
  (u/throw-ex
   (str
    (name method)
    " - method not implemented for this storage layer")))

(defprotocol Store
  "The interface for all storage layer technologies."
  (open-connection [store connection-info]
    "Open a connection to the storage layer, if not already connected.
     Return true on success. Raise an exception if a new
     connection cannot be obtained.")
  (close-connection [store]
    "Close the active connection, return true on success, false if the connection
     cannot be closed.")
  (parse-connection-info [store connection-info]
    "Parse a map into the connection information specific to the store.")
  (connection-info [store]
    "Return information about the current connection")
  (create-schema [store component-name]
    "Initialize the schema to store entity-instances defined
     in the component. On success, return component-name. If the schema
     already exists, return nil. On failure, raise an exception.")
  (drop-schema [store component-name]
    "Drop the schema for the component. Return component-name on success, nil if the
     schema does not exist. On failure, raise an exception.")
  (fetch-schema [store]
    "Return the schema as a map. Return nil if the schema cannot be retrieved.")
  (create-table [store entity-name]
    "Create a table for a newly defined entity.")
  (upsert-instance [store entity-name instance]
    "Insert or update the instance in the store. On success, return instance.")
  (create-instance [store entity-name instance]
    "Insert the instance in the store. On success, return instance.
     On failure, raise an exception.")
  (update-instance [store entity-name instance]
    "Update the instance without violating unique-key constraints.")
  (delete-by-id [store entity-name id-attr-name id]
    "Delete the instance with the given id. On success, return id.
     If the instance does not exist, return nil. On failure, raise an exception.")
  (delete-all [store entity-name purge] "Delete all instances.")
  (delete-children [store entity-name path] "Delete all instances by parent path.")
  (query-by-id [store entity-name query-sql ids]
    "Return the instances with the given id-attr values. Return nil if the instances
     does not exist. On failure, raise an exception.")
  (query-by-unique-keys [store entity-name unique-keys unique-values]
    "Return the instance with the given unique values, if no data found, return nil.")
  (query-all [store entity-name query-sql]
    "Return all instances of the entity. Return nil if the instances
     does not exist. On failure, raise an exception.")
  (do-query [store query query-params]
    "Return all instances that satisfy the query. Return nil if no data found.
     On failure or if the query is not supported, raise an exception.")
  (call-in-transaction [store f]
    "Call the function f in a transaction.")
  (compile-query [store query-pattern]
    "Compile the query from a dataflow pattern to a format understood by this
     store implementation.")
  (get-reference [store path refs]
    "Get reference to instances stored in the store. This is useful for
     tracking instances in reactive store")
  (plan-changeset [store changeset-inst]
    "Generate migration script/plan for the changeset")
  (commit [store msg]
    "Commit local changes, return the version number"
    (not-implemented :commit)))
