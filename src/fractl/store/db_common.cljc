(ns fractl.store.db-common
  (:require [clojure.string :as s]
            [clojure.set :as set]
            [fractl.component :as cn]
            [fractl.util :as u]
            [fractl.util.seq :as us]
            [fractl.lang.internal :as li]
            [fractl.store.util :as su]
            [fractl.store.sql :as sql]
            #?(:clj [fractl.store.jdbc-internal :as ji])
            #?(:clj [fractl.store.postgres-internal :as pi])
            #?(:clj [fractl.store.h2-internal :as h2i]
               :cljs [fractl.store.alasql-internal :as aqi])))

(def ^:private store-fns
  {:transact-fn! #?(:clj ji/transact-fn! :cljs aqi/execute-fn!)
   :execute-fn! #?(:clj ji/execute-fn! :cljs aqi/execute-fn!)
   :execute-sql! #?(:clj ji/execute-sql! :cljs aqi/execute-sql!)
   :execute-stmt! #?(:clj ji/execute-stmt! :cljs aqi/execute-stmt!)
   :upsert-inst-statement #?(:clj h2i/upsert-inst-statement :cljs aqi/upsert-inst-statement)
   :upsert-index-statement #?(:clj h2i/upsert-index-statement :cljs aqi/upsert-index-statement)
   :delete-by-id-statement #?(:clj ji/delete-by-id-statement :cljs aqi/delete-by-id-statement)
   :delete-index-statement #?(:clj ji/delete-index-statement :cljs aqi/delete-index-statement)
   :query-by-id-statement #?(:clj ji/query-by-id-statement :cljs aqi/query-by-id-statement)
   :do-query-statement #?(:clj ji/do-query-statement :cljs aqi/do-query-statement)
   :validate-ref-statement #?(:clj ji/validate-ref-statement :cljs aqi/validate-ref-statement)})

(def transact-fn! (:transact-fn! store-fns))
(def execute-fn! (:execute-fn! store-fns))
(def execute-sql! (:execute-sql! store-fns))
(def execute-stmt! (:execute-stmt! store-fns))
(def upsert-inst-statement (:upsert-inst-statement store-fns))
(def upsert-index-statement (:upsert-index-statement store-fns))
(def delete-by-id-statement (:delete-by-id-statement store-fns))
(def delete-index-statement (:delete-index-statement store-fns))
(def query-by-id-statement (:query-by-id-statement store-fns))
(def do-query-statement (:do-query-statement store-fns))
(def validate-ref-statement (:validate-ref-statement store-fns))

(defn- create-entity-table-sql
  "Given a database-type, entity-table-name and identity-attribute name,
  return the DML statement to create that table."
  [tabname ident-attr]
  [(str su/create-table-prefix " " tabname " "
        (if ident-attr
          (str "(" (su/db-ident ident-attr) " UUID PRIMARY KEY, ")
          "(")
        "instance_json VARCHAR)")])

(defn- create-index-table-sql
  "Given a database-type, entity-table-name and attribute-column name, return the
  DML statements for creating an index table and the index for its 'id' column."
  [entity-table-name colname coltype unique?]
  (let [index-tabname (su/index-table-name entity-table-name colname)]
    [[(str su/create-table-prefix " " index-tabname " "
          ;; `id` is not a foreign key reference to the main table,
          ;; because insert is fully controlled by the V8 runtime and
          ;; we get an index for free.
           "(Id UUID PRIMARY KEY, "
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
    (execute-fn! datasource
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
    (execute-fn! datasource
               (fn [txn]
                 (drop-db-schema! txn scmname)))
    component-name))

(defn create-table
  "Create the table and indexes for the entity."
  [datasource entity-name]
  (execute-fn!
   datasource
   (fn [txn]
     (let [tabname (su/table-for-entity entity-name)
           schema (su/find-entity-schema entity-name)
           indexed-attrs (cn/indexed-attributes schema)]
       (create-tables! txn schema tabname :Id indexed-attrs))))
  entity-name)

(defn- upsert-indices!
  "Insert or update new index entries relevant for an entity instance.
  The index values are available in the `attrs` parameter."
  [conn entity-table-name indexed-attrs instance upsert-index-statement]
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
          tabname (su/table-for-entity [component entity-name])
          rattr (first (:refs p))
          colname (name rattr)
          index-tabname (if (= rattr :Id) tabname (su/index-table-name tabname colname))
          [stmt params] (validate-ref-statement conn index-tabname colname (get inst aname))]
      (when-not (seq (execute-stmt! conn stmt params))
        (u/throw-ex (str "Reference not found - " aname ", " p))))))

(defn- upsert-inst!
  "Insert or update an entity instance."
  [conn table-name inst ref-attrs upsert-inst-statement]
  (when (seq ref-attrs)
    (validate-references! conn inst ref-attrs))
  (let [attrs (cn/serializable-attributes inst)
        id (:Id attrs)
        obj (su/clj->json (dissoc attrs :Id))
        [pstmt params] (upsert-inst-statement conn table-name id obj)]
    (execute-stmt! conn pstmt params)))

(defn- remove-unique-attributes [indexed-attrs entity-schema]
  (if-let [uq-attrs (seq (cn/unique-attributes entity-schema))]
    (clojure.set/difference (set indexed-attrs) (set uq-attrs))
    indexed-attrs))

(defn- set-excluded-columns [col-names]
  (loop [cs col-names, s ""]
    (if-let [c (first cs)]
      (recur (rest cs)
             (str s " " c " = EXCLUDED." c
                  (when (seq (rest cs))
                    ", ")))
      s)))

(defn upsert-dynamic-entity-instance [datasource entity-name instance]
  (let [tabname (name (second entity-name))
        id-attr (cn/identity-attribute-name entity-name)
        id-attr-nm (name id-attr)
        ks (keys (cn/instance-attributes instance))
        col-names (map name ks)
        col-vals (map #(% instance) ks)
        sql (str "INSERT INTO " tabname "("
                 (us/join-as-string col-names ", ")
                 ") VALUES ("
                 (us/join-as-string (mapv (constantly "?") col-vals) ", ")
                 ")  ON CONFLICT (" id-attr-nm ") DO UPDATE SET"
                 (set-excluded-columns
                  (set/difference (set col-names) #{id-attr-nm})))]
    (execute-fn!
     datasource
     #(apply
       execute-stmt! %
       (do-query-statement % sql col-vals)))
    instance))

(defn upsert-instance
  ([upsert-inst-statement upsert-index-statement datasource
    entity-name instance update-unique-indices?]
   (if (or (cn/has-dynamic-entity-flag? instance)
           (cn/dynamic-entity? entity-name))
     (upsert-dynamic-entity-instance
      datasource entity-name instance)
     (let [tabname (su/table-for-entity entity-name)
           entity-schema (su/find-entity-schema entity-name)
           all-indexed-attrs (cn/indexed-attributes entity-schema)
           indexed-attrs (if update-unique-indices?
                           all-indexed-attrs
                           (remove-unique-attributes
                            all-indexed-attrs entity-schema))
           ref-attrs (cn/ref-attribute-schemas entity-schema)]
       (transact-fn! datasource
                     (fn [txn]
                     (upsert-inst!
                      txn tabname instance ref-attrs
                      upsert-inst-statement)
                       (upsert-indices!
                        txn tabname indexed-attrs instance
                        upsert-index-statement)))
       instance)))
  ([datasource entity-name instance]
   (if (or (cn/has-dynamic-entity-flag? instance)
           (cn/dynamic-entity? entity-name))
     (upsert-dynamic-entity-instance
      datasource entity-name instance)
     (upsert-instance
      upsert-inst-statement upsert-index-statement
      datasource entity-name instance true))))

(defn update-instance
  ([upsert-inst-statement upsert-index-statement datasource entity-name instance]
   (upsert-instance upsert-inst-statement upsert-index-statement datasource
                    entity-name instance false))
  ([datasource entity-name instance]
   (upsert-instance upsert-inst-statement upsert-index-statement datasource
                    entity-name instance false)))

(defn- delete-indices!
  "Delete index entries relevant for an entity instance."
  [conn entity-table-name indexed-attrs id delete-index-statement]
  (let [index-tabnames (su/index-table-names entity-table-name indexed-attrs)]
    (doseq [[attrname tabname] index-tabnames]
      (let [[pstmt params] (delete-index-statement
                            conn tabname
                            (su/db-ident attrname) id)]
        (execute-stmt! conn pstmt params)))))

(defn- delete-inst!
  "Delete an entity instance."
  [conn tabname id delete-by-id-statement]
  (let [[pstmt params] (delete-by-id-statement conn tabname id)]
    (execute-stmt! conn pstmt params)))

(defn delete-by-id
  ([delete-by-id-statement delete-index-statement datasource entity-name id]
   (let [tabname (su/table-for-entity entity-name)
         entity-schema (su/find-entity-schema entity-name)
         indexed-attrs (cn/indexed-attributes entity-schema)]
     (transact-fn! datasource
                   (fn [txn]
                     (delete-indices! txn tabname indexed-attrs id delete-index-statement)
                     (delete-inst! txn tabname id delete-by-id-statement)))
     id))
  ([datasource entity-name id]
   (delete-by-id delete-by-id-statement delete-index-statement datasource entity-name id)))

(def compile-to-indexed-query
  (partial
   sql/compile-to-indexed-query
   su/table-for-entity
   su/index-table-name))

(defn- column-names-and-values [where-clause]
  (let [conds (if (= :and (first where-clause))
                (rest where-clause)
                [where-clause])]
    (map (fn [c] [(name (second c)) (nth c 2)]) conds)))

(defn compile-to-direct-query [query-pattern]
  (let [where-clause (:where query-pattern)
        namevals (if (= where-clause :*)
                   :*
                   (column-names-and-values where-clause))]
    {:query [(sql/compile-to-direct-query
              (name (second (:from query-pattern)))
              (map first namevals))
             (if (keyword? where-clause)
               where-clause
               (map second namevals))]}))

(defn- raw-results [query-fns]
  (flatten (map u/apply0 query-fns)))

(defn- query-instances [entity-name query-fns]
  (let [[id-key json-key] (su/make-result-keys entity-name)
        results (raw-results query-fns)]
    (su/results-as-instances entity-name id-key json-key results)))

(defn query-by-id
  ([query-by-id-statement datasource entity-name query-sql ids]
   (execute-fn!
    datasource
    (fn [conn]
      (query-instances
       entity-name
       (map #(let [[pstmt params] (query-by-id-statement conn query-sql %)]
               (fn [] (execute-stmt! conn pstmt params)))
            (set ids))))))
  ([datasource entity-name query-sql ids]
   (query-by-id query-by-id-statement datasource entity-name query-sql ids)))

(defn do-query [datasource query-sql query-params]
  (execute-fn!
   datasource
   (fn [conn]
     (let [[pstmt params] (do-query-statement conn query-sql query-params)]
       (execute-stmt! conn pstmt params)))))

(defn- row-as-dynamic-entity [entity-name row]
  (cn/make-instance
   entity-name
   (into {} (map (fn [[k v]] [(second (li/split-path k)) v]) row))))

(defn- dynamic-query-instances [entity-name query-fns]
  (let [results (raw-results query-fns)]
    (mapv (partial row-as-dynamic-entity entity-name) results)))

(defn- query-dynamic-entity-by-unique-keys [datasource entity-name unique-keys attribute-values]
  (let [sql (sql/compile-to-direct-query (name (second entity-name)) (map name unique-keys))]
    (when-let [rows (seq (do-query datasource sql (map #(attribute-values %) unique-keys)))]
      (row-as-dynamic-entity entity-name (first rows)))))

(defn query-by-unique-keys
  "Query the instance by a unique-key value."
  ([query-by-id-statement datasource entity-name unique-keys attribute-values]
   (if (cn/has-dynamic-entity-flag? attribute-values)
     (query-dynamic-entity-by-unique-keys
      datasource entity-name unique-keys attribute-values)
     (when-not (and (= 1 (count unique-keys)) (= :Id (first unique-keys)))
       (let [ks (filter #(not= :Id %) unique-keys)]
         (first
          (filter
           identity
           (map
            (fn [k]
              (let [c (compile-to-indexed-query
                       {:from  entity-name
                        :where [:= k (get attribute-values k)]})
                    id-query (:query (first (:id-queries c)))
                    id-result (do-query datasource (first id-query) (rest id-query))]
                (when (seq id-result)
                  (let [id (second (first (filter (fn [[k _]] (= "ID" (s/upper-case (name k)))) (first id-result))))
                        result (if query-by-id-statement
                                 (query-by-id query-by-id-statement datasource entity-name (:query c) [id])
                                 (query-by-id datasource entity-name (:query c) [id]))]
                    (first result)))))
            ks)))))))
  ([datasource entity-name unique-keys attribute-values]
   (query-by-unique-keys nil datasource entity-name unique-keys attribute-values)))

(defn query-all
  ([datasource entity-name rows-to-instances query-sql query-params]
   (execute-fn!
    datasource
    (fn [conn]
      (rows-to-instances
       entity-name
       (let [[pstmt params] (do-query-statement conn query-sql query-params)]
         [#(execute-stmt! conn pstmt params)])))))
  ([datasource entity-name query-sql]
   (query-all datasource entity-name query-instances query-sql nil)))

(defn query-all-dynamic [datasource entity-name query]
  (query-all datasource entity-name dynamic-query-instances
   (first query) (second query)))

(defn- query-pk-columns [conn table-name sql]
  (let [pstmt (do-query-statement conn (s/replace sql #"\?" table-name))]
    (mapv :pg_attribute/attname (execute-stmt! conn pstmt nil))))

(defn- mark-pks [pks schema]
  (map
   #(let [colname (:columns/column_name %)]
      (if (some #{colname} pks)
        (assoc % :columns/pk true)
        %))
   schema))

(defn- normalize-table-schema [type-lookup cols]
  (apply
   merge
   (mapv
    (fn [c]
      (if-let [t (type-lookup (:columns/data_type c))]
        {(keyword (:columns/column_name c))
         (merge {:type t} (when (:columns/pk c) {:unique true :immutable true}))}
        (u/throw-ex (str "type not supported - " (:columns/data_type c)))))
    cols)))

(defn fetch-schema [datasource fetch-schema-sql
                    get-table-names fetch-columns-sql
                    fetch-pk-columns-sql type-lookup]
  (execute-fn!
   datasource
   (fn [conn]
     (let [[pstmt params] (do-query-statement conn fetch-schema-sql nil)
           tabnames (get-table-names
                     (raw-results
                      [#(execute-stmt! conn pstmt params)]))
           col-pstmt (do-query-statement conn fetch-columns-sql)]
       (mapv
        (fn [tn]
          (let [pks (query-pk-columns conn tn fetch-pk-columns-sql)
                r (raw-results
                   [#(execute-stmt!
                      conn col-pstmt [tn])])]
            {(keyword tn) (normalize-table-schema type-lookup (mark-pks pks r))}))
        tabnames)))))
