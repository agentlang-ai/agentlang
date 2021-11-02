(ns fractl.store.sql
  "Support for translating dataflow-query patterns to generic SQL."
  (:require [clojure.string :as str]
            [honeysql.core :as hsql]
            [fractl.util :as u]))

(defn- select-from-index-table [index-table-name where-clause]
  (if (= :Id (keyword (second where-clause)))
    {:result (nth where-clause 2)}
    {:query
     (hsql/format
      {:select [:*]
       :from [(keyword index-table-name)]
       :where
       (let [f (first where-clause)]
         (cond
           (string? f)
           [(keyword f) (keyword (second where-clause)) (nth where-clause 2)]
           (seqable? f) f
           :else where-clause))})}))

(defn- concat-where-clauses [clauses]
  (if (> (count clauses) 1)
    (reduce conj [:and] clauses)
    (first clauses)))

(defn compile-to-indexed-query [table-name-fn index-table-name-fn query-pattern]
  (let [table (table-name-fn (:from query-pattern))
        where-clause (:where query-pattern)]
    (if (= :* where-clause)
      {:query (str "SELECT * FROM " table)}
      (let [fc (first where-clause)
            logical-clause (and (keyword? fc)
                                (or (= fc :and) (= fc :or)))
            norm-where-clause (if logical-clause
                                (rest where-clause)
                                (if (vector? (first where-clause))
                                  where-clause
                                  [where-clause]))
            index-tables (distinct (mapv #(index-table-name-fn table (second %)) norm-where-clause))]
        ;; (when (and logical-clause (> (count index-tables) 1))
        ;;   (u/throw-ex (str "cannot merge multiple indices under an `and` clause - " index-tables)))
        (let [qs (cond
                   (= (count index-tables) 1)
                   [(select-from-index-table
                     (first index-tables)
                     (concat-where-clauses norm-where-clause))]

                   (not= (count index-tables) (count norm-where-clause))
                   (u/throw-ex (str "cannot match where clause to index tables - " where-clause))

                   :else
                   (mapv #(select-from-index-table %1 %2) index-tables norm-where-clause))]
          {:id-queries qs
           :merge-opr
           (if logical-clause
             fc
             :or)
           :query
           (str "SELECT * FROM " table " WHERE Id = ?")})))))

(defn compile-to-direct-query [table-name col-names]
  (let [sql (str "SELECT * FROM " table-name)]
    (if (= :* col-names)
      sql
      (str sql " WHERE "
           (loop [cs col-names, s ""]
             (if-let [c (first cs)]
               (recur (rest cs)
                      (str s c " = ? "
                           (when (seq (rest cs))
                             "AND ")))
               s))))))

(defn sql-index-type
  ([max-varchar-length bool-type date-time-type attribute-type]
   (case attribute-type
     (:Kernel/String
      :Kernel/Keyword :Kernel/Email
      :Kernel/DateTime :Kernel/Date :Kernel/Time)
     (str "VARCHAR(" max-varchar-length ")")
     :Kernel/UUID "UUID"
     :Kernel/Int "INT"
     (:Kernel/Int64 :Kernel/Integer) "BIGINT"
     :Kernel/Float "REAL"
     :Kernel/Double "DOUBLE"
     :Kernel/Decimal "DECIMAL"
     :Kernel/Boolean bool-type
     (u/throw-ex (str "type cannot be indexed - " attribute-type))))
  ([attribute-type]
   #?(:clj
      ;; For postgres
      (sql-index-type "10485760" "BOOLEAN" "DATE" attribute-type)
      ;(sql-index-type Integer/MAX_VALUE "BOOLEAN" "DATE" attribute-type)
      :cljs (sql-index-type (.-MAX_SAFE_INTEGER js/Number) "BOOLEAN" "DATE" attribute-type))
   ))
