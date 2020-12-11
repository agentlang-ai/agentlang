(ns fractl.store.db-common
  (:require [fractl.component :as cn]
            [fractl.util :as u]
            [fractl.store.util :as su]
            [fractl.store.sql :as sql]
            #?(:clj [fractl.store.h2-internal :as h2i]
               :cljs [fractl.store.alasql-internal :as aqi])))

(def ^:private store-fns
  {:transact! #?(:clj h2i/transact! :cljs aqi/transact!)
   :execute-sql! #?(:clj h2i/execute-sql! :cljs aqi/execute-sql!)
   :execute-stmt! #?(:clj h2i/execute-stmt! :cljs aqi/execute-stmt!)
   :upsert-inst-statement #?(:clj h2i/upsert-inst-statement :cljs aqi/upsert-inst-statement)
   :upsert-index-statement #?(:clj h2i/upsert-index-statement :cljs aqi/upsert-index-statement)
   :delete-inst-statement #?(:clj h2i/delete-inst-statement :cljs aqi/delete-inst-statement)
   :delete-index-statement #?(:clj h2i/delete-index-statement :cljs aqi/delete-index-statement)
   :query-by-id-statement #?(:clj h2i/query-by-id-statement :cljs aqi/query-by-id-statement)
   :do-query-statement #?(:clj h2i/do-query-statement :cljs aqi/do-query-statement)
   :validate-ref-statement #?(:clj h2i/validate-ref-statement :cljs aqi/validate-ref-statement)})

(def transact! (partial (:transact! store-fns)))
(def execute-sql! (partial (:execute-sql! store-fns)))
(def execute-stmt! (partial (:execute-stmt! store-fns)))
(def upsert-inst-statement (partial (:upsert-inst-statement store-fns)))
(def upsert-index-statement (partial (:upsert-index-statement store-fns)))
(def delete-inst-statement (partial (:delete-inst-statement store-fns)))
(def delete-index-statement (partial (:delete-index-statement store-fns)))
(def query-by-id-statement (partial (:query-by-id-statement store-fns)))
(def do-query-statement (partial (:do-query-statement store-fns)))
(def validate-ref-statement (partial (:validate-ref-statement store-fns)))

(defn create-entity-table-sql
  "Given a database-type, entity-table-name and identity-attribute name,
  return the DML statement to create that table."
  [tabname ident-attr]
  [(str su/create-table-prefix " " tabname " "
        (if ident-attr
          (str "(" (su/db-ident ident-attr) " UUID, ")
          "(")
        "instance_json JSON)")])

(defn create-index-table-sql
  "Given a database-type, entity-table-name and attribute-column name, return the
  DML statements for creating an index table and the index for its 'id' column."
  [entity-table-name colname coltype unique?]
  (let [index-tabname (su/index-table-name entity-table-name colname)]
    [[(str su/create-table-prefix " " index-tabname " "
          ;; `id` is not a foreign key reference to the main table,
          ;; because insert is fully controlled by the V8 runtime and
          ;; we get an index for free.
           "(id UUID, "
          ;; Storage and search can be optimized by inferring a more appropriate
          ;; SQL type for `colname`, see the issue https://ventur8.atlassian.net/browse/V8DML-117.
           colname " " coltype
           (if unique? (str ",UNIQUE(" colname "))") ")"))]
     [(su/create-index-sql index-tabname colname unique?)]]))

(defn create-identity-index-sql [entity-table-name colname]
  [(str su/create-unique-index-prefix
        " " (su/index-name entity-table-name)
        " ON " entity-table-name "(" colname ")")])

(defn- create-identity-index! [connection entity-table-name ident-attr]
  (let [sql (create-identity-index-sql entity-table-name (su/db-ident ident-attr))]
    (if (execute-sql! connection sql)
      entity-table-name
      (u/throw-ex (str "Failed to create index table for identity column - "
                       [entity-table-name ident-attr])))))

(defn- create-entity-table!
  "Create a table to store instances of an entity. As 'identity-attribute' is
  specified to be used as the primary-key in the table."
  [connection tabname ident-attr]
  (let [sql (create-entity-table-sql tabname ident-attr)]
    (if (execute-sql! connection sql)
      tabname
      (u/throw-ex (str "Failed to create table for " tabname)))))

(defn- create-index-table! [connection entity-schema entity-table-name attrname idxattr]
  (let [[tabsql idxsql] (create-index-table-sql
                         entity-table-name attrname
                         (sql/sql-index-type (cn/attribute-type entity-schema idxattr))
                         (cn/unique-attribute? entity-schema idxattr))]
    (when-not (and (execute-sql! connection tabsql)
                   (execute-sql! connection idxsql))
      (u/throw-ex (str "Failed to create lookup table for " [entity-table-name attrname])))))

(defn- create-tables!
  "Create the main entity tables and lookup tables for the indexed attributes."
  [connection entity-schema entity-table-name ident-attr indexed-attrs]
  (create-entity-table! connection entity-table-name ident-attr)
  (when ident-attr
    (create-identity-index! connection entity-table-name ident-attr))
  (let [cit (partial create-index-table! connection entity-schema entity-table-name)]
    (doseq [idxattr indexed-attrs]
      (let [attrname (su/db-ident idxattr)]
        (cit attrname idxattr)))
    entity-table-name))

(defn- create-db-schema!
  "Create a new schema (a logical grouping of tables), if it does not already exist."
  [connection db-schema-name]
  (if (execute-sql! connection [(su/create-schema-sql db-schema-name)])
    db-schema-name
    (u/throw-ex (str "Failed to create schema - " db-schema-name))))

(defn- drop-db-schema! [connection db-schema-name]
  (if (execute-sql! connection [(su/drop-schema-sql db-schema-name)])
    db-schema-name
    (u/throw-ex (str "Failed to drop schema - " db-schema-name))))

(defn create-schema
  "Create the schema, tables and indexes for the component."
  [datasource component-name]
  (let [scmname (su/db-schema-for-component component-name)]
    (transact! datasource
               (fn [txn]
                 (create-db-schema! txn scmname)
                 (doseq [ename (cn/entity-names component-name)]
                   (let [tabname (su/table-for-entity ename)
                         schema (su/find-entity-schema ename)
                         indexed-attrs (cn/indexed-attributes schema)]
                     (create-tables! txn schema tabname :Id indexed-attrs)))))
    component-name))

(defn drop-schema
  "Remove the schema from the database, perform a non-cascading delete."
  [datasource component-name]
  (let [scmname (su/db-schema-for-component component-name)]
    (transact! datasource
               (fn [txn]
                 (drop-db-schema! txn scmname)))
    component-name))

(defn- upsert-indices!
  "Insert or update new index entries relevant for an entity instance.
  The index values are available in the `attrs` parameter."
  [conn entity-table-name indexed-attrs instance]
  (let [id (:Id instance)]
    (doseq [[attrname tabname] (su/index-table-names entity-table-name indexed-attrs)]
      (let [[pstmt params] (upsert-index-statement conn tabname (su/db-ident attrname)
                                                   id (attrname instance))]
        (execute-stmt! conn pstmt params)))))

(defn- validate-references! [conn inst ref-attrs]
  (doseq [[aname scmname] ref-attrs]
    (let [p (cn/find-ref-path scmname)
          component (:component p)
          entity-name (:record p)
          tabname (su/table-for-entity [component entity-name] (name component))
          rattr (first (:refs p))
          colname (name rattr)
          index-tabname (if (= rattr :Id) tabname (su/index-table-name tabname colname))
          [stmt params] (validate-ref-statement conn index-tabname colname (get inst aname))]
      (when-not (seq (execute-stmt! conn stmt params))
        (u/throw-ex (str "Reference not found - " aname ", " p))))))

(defn- upsert-inst!
  "Insert or update an entity instance."
  [conn table-name inst ref-attrs]
  (when (seq ref-attrs)
    (validate-references! conn inst ref-attrs))
  (let [attrs (cn/serializable-attributes inst)
        id (:Id attrs)
        obj (su/clj->json (dissoc attrs :Id))
        [pstmt params] (upsert-inst-statement conn table-name id obj)]
    (execute-stmt! conn pstmt params)))

(defn upsert-instance [datasource entity-name instance]
  (let [tabname (su/table-for-entity entity-name)
        entity-schema (su/find-entity-schema entity-name)
        indexed-attrs (cn/indexed-attributes entity-schema)
        ref-attrs (cn/ref-attribute-schemas entity-schema)]
    (transact! datasource
               (fn [txn]
                 (upsert-inst! txn tabname instance ref-attrs)
                 (upsert-indices! txn tabname indexed-attrs instance)))
    instance))

(defn- delete-indices!
  "Delete index entries relevant for an entity instance."
  [conn entity-table-name indexed-attrs id]
  (let [index-tabnames (su/index-table-names entity-table-name indexed-attrs)]
    (doseq [[attrname tabname] index-tabnames]
      (let [[pstmt params] (delete-index-statement
                            conn tabname
                            (su/db-ident attrname) id)]
        (execute-stmt! conn pstmt params)))))

(defn- delete-inst!
  "Delete an entity instance."
  [conn tabname id]
  (let [[pstmt params] (delete-inst-statement conn tabname id)]
    (execute-stmt! conn pstmt params)))

(defn delete-instance [datasource entity-name instance]
  (let [id (:Id instance)
        tabname (su/table-for-entity entity-name)
        entity-schema (su/find-entity-schema entity-name)
        indexed-attrs (cn/indexed-attributes entity-schema)]
    (transact! datasource
               (fn [txn]
                 (delete-indices! txn tabname indexed-attrs id)
                 (delete-inst! txn tabname id)))
    id))

(defn query-by-id [datasource entity-name query-sql ids]
  (transact! datasource
             (fn [txn]
               (let [[id-key json-key] (su/make-result-keys entity-name)
                     results (flatten (map #(let [[pstmt params] (query-by-id-statement txn query-sql %)]
                                              (execute-stmt! txn pstmt params))
                                           (set ids)))]
                 ((partial su/results-as-instances entity-name id-key json-key)
                  results)))))

(defn do-query [datasource query-sql query-params]
  (transact! datasource
             (fn [txn]
               (let [[pstmt params] (do-query-statement txn query-sql query-params)]
                 (execute-stmt! txn pstmt params)))))

(def compile-to-indexed-query (partial sql/compile-to-indexed-query
                                       su/table-for-entity
                                       su/index-table-name))

