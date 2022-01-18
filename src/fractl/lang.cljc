(ns fractl.lang
  "The core constructs of the modeling language."
  (:require [clojure.set :as set]
            [clojure.string :as s]
            [clojure.walk :as w]
            [fractl.util :as u]
            [fractl.lang.internal :as li]
            [fractl.lang.kernel :as k]
            [fractl.component :as cn]
            [fractl.compiler :as c]
            [fractl.compiler.rule :as rl]
            [fractl.evaluator.state :as es]
            [fractl.compiler.context :as ctx]
            [fractl.resolver.registry :as r]
            #?(:cljs [reagent.core :as reagent])))

(defn- normalize-imports [imports]
  (let [imps (rest imports)]
    (if (keyword? (first imps))
      [imps]
      imps)))

(declare init)

(def ^:private component-spec-validators
  {:import #(normalize-imports
             (li/validate-imports %))
   :clj-import li/validate-clj-imports
   :java-import li/validate-java-imports
   :v8-import li/validate-clj-imports})

(defn- validate-component-spec [spec]
  (into
   {}
   (map
    (fn [[k v]]
      (let [vf (or (k component-spec-validators)
                   identity)]
        [k (vf v)]))
    spec)))

(defn component
  "Create and activate a new component with the given name."
  ([n spec]
   (init)
   (let [ns-name (li/validate-name n)]
     (cn/create-component
      ns-name
      (when spec (validate-component-spec spec)))))
  ([n] (component n nil)))

(defn- attribute-type? [nm]
  (or (cn/find-attribute-schema nm)
      (cn/find-record-schema nm)))

(defn- rewrite-ref-path [scm]
  (if-let [p (:ref scm)]
    (assoc scm :ref (li/path-parts p))
    scm))

(defn- normalize-attribute-schema [scm]
  (rewrite-ref-path (if (fn? scm)
                      {:check scm}
                      scm)))

(defn- normalize-oneof-values [xs]
  (map #(if (keyword? %)
          (name %)
          %)
       xs))

(defn- assoc-oneof-default [scm]
  (if-let [d (:default scm)]
    (assoc scm :default
           (if (keyword? d)
             (name d)
             d))
    scm))

(defn- oneof-as-check
  "Convert a {:oneof [a b c]} to {:check #(some #{%} [a b c])}."
  [attr-schema]
  (if-let [xs (seq (:oneof attr-schema))]
    (let [values (set (normalize-oneof-values xs))]
      (assoc (dissoc (assoc-oneof-default attr-schema) :oneof)
             :check (fn [x] (some #{x} values))))
    attr-schema))

(defn- reference-exists? [path]
  (if-let [scm (cn/find-attribute-schema path)]
    true
    false))

(defn- query-pattern? [a-map]
  (when-not (:eval a-map)
    (let [ks (keys a-map)
          k (first ks)]
      (and (= 1 (count ks))
           (li/name? k)
           (map? (get a-map k))))))

(defn- fn-or-name? [x]
  (or (fn? x) (li/name? x)))

(defn- encryption? [x]
  ;; true/:default means use the default encryption algorithm.
  ;; In future, specific algorithms may be supported
  ;; as an enum of keywords, e.g - :bcrypt, :sha512 etc.
  (or (= true x)
      (= :default x)))

(defn- future-spec? [x]
  #?(:clj (= clojure.lang.Atom (type x))
     :cljs x))

(def ^:private eval-block-keys #{:patterns :refresh-ms :timeout-ms :opcode})

(defn- eval-block? [x]
  (and (map? x)
       (every?
        #(some #{%} eval-block-keys)
        (keys x))))

(defn- finalize-raw-attribute-schema [scm]
  (doseq [[k v] scm]
    (case k
      :check (li/validate fn? ":check is not a predicate" v)
      :unique (li/validate-bool :unique v)
      :immutable (li/validate-bool :immutable v)
      :optional (li/validate-bool :optional v)
      :default (when-not (fn? v)
                 (when-let [predic (:check scm)]
                   (li/validate predic "invalid value for :default" v)))
      :type (li/validate attribute-type? "invalid :type" v)
      :expr (li/validate fn-or-name? ":expr has invalid value" v)
      :eval (li/validate eval-block? ":eval has invalid value" v)
      :query (li/validate fn? ":query must be a compiled pattern" v)
      :format (li/validate string? ":format must be a textual pattern" v)
      :listof (li/validate attribute-type? ":listof has invalid type" v)
      :setof (li/validate attribute-type? ":setof has invalid type" v)
      :indexed (li/validate-bool :indexed v)
      :write-only (li/validate-bool :write-only v)
      :type-in-store (li/validate string? ":type-in-store must be specified as a string" v)
      :ref (li/validate reference-exists? ":ref is invalid" v)
      :var (li/validate-bool :var v)
      :writer (li/validate fn? ":writer must be a function" v)
      :secure-hash (li/validate-bool :secure-hash v)
      :future (li/validate future-spec? "invalid specification for :future" v)
      (u/throw-ex (str "invalid constraint in attribute definition - " k))))
  (merge
   {:unique false :immutable false}
   (if-let [fmt (:format scm)]
     (assoc scm :format (partial re-matches (re-pattern fmt)))
     scm)))

(defn- find-ref-type [path]
  (when-let [scm (cn/find-attribute-schema path)]
    (or (:type scm)
        (when-let [rpath (:ref scm)]
          (find-ref-type rpath)))))

(defn- maybe-assoc-ref-type [attrscm]
  (if (:type attrscm)
    attrscm
    (if-let [rpath (and (not (:listof attrscm)) (:ref attrscm))]
      (if-let [tp (find-ref-type rpath)]
        (assoc attrscm :type tp)
        attrscm)
      attrscm)))

(defn- validate-attribute-schema-map-keys [scm]
  (let [newscm (maybe-assoc-ref-type
                (finalize-raw-attribute-schema (oneof-as-check scm)))]
    (if (:unique newscm)
      (assoc newscm :indexed true)
      newscm)))

(defn- validate-attribute-schema [n scm]
  (if (fn? scm)
    scm
    (validate-attribute-schema-map-keys
     (li/validate map? (str n " - attribute specification should be a map") scm))))

(defn attribute
  "Add a new attribute definition to the component."
  [n scm]
  (cn/intern-attribute
   (li/validate-name-relaxed n)
   (normalize-attribute-schema
    (validate-attribute-schema n scm))))

(defn- validate-attributes [attrs]
  (doseq [[k v] attrs]
    (li/validate-name k)
    (cond
      (keyword? v) (when-not (attribute-type? v)
                     (u/throw-ex (str "type not defined - " v)))
      (map? v) (validate-attribute-schema-map-keys v)
      (not (list? v)) (u/throw-ex (str "invalid attribute specification - " v))))
  attrs)

(defn- query-eval-fn [recname attrs k v]
  ;; TODO: implement the query->fn compilation phase.
  (u/throw-ex (str k " - inline compilation for :query not implemented")))

(def ^:private default-expression-compiler [c/compile-attribute-expression nil])

(defn- fetch-expression-compiler [expr]
  (if (vector? expr)
    (c/expression-compiler (first expr))
    default-expression-compiler))

(defn- attref? [n]
  (let [[[_ _] a] (li/ref-as-names n)]
    (if a true false)))

(defn- on-set-attrs-event-name [entity-name]
  (let [[c n] (li/split-path entity-name)]
    (keyword (str (name c) "/" (name n) "_OnSetAttributes"))))

(defn set-attributes!
  ([inst-name inst value-map]
   (let [scm (cn/fetch-schema inst-name)
         update-event-name (on-set-attrs-event-name inst-name)]
     (loop [obj value-map, results []]
       (if-let [[k v] (first obj)]
         (let [attr-scm (cn/find-attribute-schema (k scm))
               aval (cn/valid-attribute-value
                     k v
                     (dissoc attr-scm :future))]
           (reset! (k inst) v)
           (recur
            (rest obj)
            (conj
             results
             (let [inst (cn/ensure-type-and-name inst inst-name :entity)]
               (:result
                (first
                 ((es/get-active-evaluator)
                  (cn/make-instance
                   {update-event-name
                    {:Instance inst}}))))))))
         results))))
  ([inst value-map]
   (set-attributes! (cn/instance-name inst) inst value-map)))

(defn- process-futures [recname [k v]]
  (if (and (map? v) (:future v))
    (let [d (:default v)]
      (assoc
       v :future #?(:clj (atom d) :cljs (reagent/atom d))
       :optional true))
    v))

(defn- compile-eval-block [recname attrs evblock]
  (let [ctx (ctx/make)]
    (ctx/put-record! ctx (li/split-path recname) attrs)
    (if-let [opcode (mapv (partial c/compile-pattern ctx) (:patterns evblock))]
      opcode
      (u/throw-ex (str recname " - failed to compile eval-block")))))

(defn- normalize-eval-block [evblock]
  (when evblock
    (if (and (map? evblock) (:patterns evblock))
      evblock
      {:patterns [evblock]})))

(defn- normalize-compound-attr [recname attrs nm [k v]]
  (if-let [ev (normalize-eval-block (:eval v))]
    (attribute
     nm
     (assoc
      v
      :eval (assoc ev :opcode (compile-eval-block recname attrs ev))
      :optional true))
    (when-let [expr (:expr v)]
      (if (fn? expr)
        (attribute nm v)
        (let [[c tag] (fetch-expression-compiler expr)]
          (when tag
            (cn/register-custom-compiled-record tag recname))
          (attribute nm {:type (:type v)
                         :expr (c recname attrs k expr)}))))))

(defn- normalize-attr [recname attrs fqn [k v]]
  (let [newv
        (cond
          (map? v)
          (let [nm (fqn (li/unq-name))]
            (if (query-pattern? v)
              (attribute nm {:query (query-eval-fn recname attrs k v)})
              (or (normalize-compound-attr recname attrs nm [k v])
                  (attribute nm (process-futures recname [k v])))))
          (list? v)
          (attribute
           (fqn (li/unq-name))
           {:expr (c/compile-attribute-expression
                   recname attrs k v)})
          :else
          (let [fulln (fqn v)]
            (if (attref? fulln)
              (attribute
               (fqn (li/unq-name))
               {:ref fulln})
              fulln)))]
    [k newv]))

(defn- validated-canonical-type-name [n]
  (li/validate-name (cn/canonical-type-name n)))

(defn- required-attribute-names [attrs]
  (map first
       (filter (fn [[_ v]]
                 (if (map? v)
                   (not (or (:optional v) (:default v)))
                   true))
               attrs)))

(defn- infer-default [attr-name attr-def dict?]
  (let [type-name (if dict? (:type attr-def) attr-def)
        scm (cn/find-attribute-schema type-name)]
    (if scm
      (if-let [d (:default scm)]
        (if dict?
          (assoc attr-def :default d)
          {:type type-name
           :default d})
        (u/throw-ex (str attr-name " - no default defined for " type-name)))
      (u/throw-ex (str attr-name " - undefined type - " type-name)))))

(defn- assoc-defaults [req-attrs [aname adef]]
  (let [optional? (not (some #{aname} req-attrs))
        dict? (map? adef)]
    (when (and (not optional?) dict? (:optional adef))
      (u/throw-ex (str aname " - cannot be marked :optional")))
    [aname (if optional?
             (if (and dict? (:default adef))
               adef
               (if dict?
                 (assoc adef :optional true)
                 {:type adef :optional true}))
             adef)]))

(defn- merge-unique-flags [attrs uq-attr-names]
  (map (fn [[k v]]
         (if (some #{k} uq-attr-names)
           [k (if (keyword? v)
                {:type v
                 :unique true}
                (assoc v :unique true))]
           [k v]))
       attrs))

(defn- fetch-inherited-schema [type-name child-record-type]
  (if-let [scm (case child-record-type
                 (:entity :record)
                 (or (cn/find-entity-schema type-name)
                     (cn/find-record-schema type-name))
                 :event (or (cn/find-event-schema type-name)
                            (cn/find-record-schema type-name)))]
    (:schema scm)
    (u/throw-ex (str "parent type not found - " type-name))))

(defn- normalized-attributes [rectype recname orig-attrs]
  (let [f (partial cn/canonical-type-name (cn/get-current-component))
        meta (:meta orig-attrs)
        inherits (:inherits meta)
        inherited-scm (when inherits (fetch-inherited-schema inherits rectype))
        req-inherited-attrs (or (:required-attributes inherited-scm)
                                (required-attribute-names inherited-scm))
        base-attrs (dissoc orig-attrs :meta)
        attrs (if inherited-scm
                (merge inherited-scm base-attrs)
                base-attrs)
        req-orig-attrs (or (:required-attributes meta)
                           (required-attribute-names attrs))
        req-attrs (concat req-orig-attrs req-inherited-attrs)
        attrs-with-defaults (into {} (map (partial assoc-defaults req-attrs) attrs))
        unique-attr-names (:unique meta)
        attrs-with-uq-flags (if unique-attr-names
                              (merge-unique-flags attrs-with-defaults unique-attr-names)
                              attrs-with-defaults)
        newattrs (map (partial normalize-attr recname attrs f) attrs-with-uq-flags)
        final-attrs (into {} (validate-attributes newattrs))]
    (assoc final-attrs :meta (assoc meta :required-attributes req-attrs :record-type rectype))))

(defn- parse-and-define [f schema]
  (let [n (first (keys schema))]
    (f n (get schema n))))

(defn record
  "Add a new record definition to the component."
  ([n attrs]
   (if (map? attrs)
     (let [cn (validated-canonical-type-name n)]
       (cn/intern-record
         cn (normalized-attributes :record cn attrs)))
     (u/throw-ex (str "Syntax error in record. Check record: " n))))
  ([schema]
   (parse-and-define record schema)))

(defn- event-internal
  ([n attrs verify-name?]
   (let [cn (if verify-name?
              (validated-canonical-type-name n)
              (cn/canonical-type-name n))]
     (cn/intern-event cn (if (cn/inferred-event-schema? attrs)
                              attrs
                              (normalized-attributes :event cn attrs)))))
  ([n attrs]
   (event-internal n attrs false)))

(defn- ensure-no-reserved-event-attrs! [attrs]
  (when (some #(= :EventContext (first %)) attrs)
    (u/throw-ex ":EventContext is a reserved attribute name")))

(defn event
  "An event record with timestamp and other auto-generated meta fields."
  ([n attrs]
   (ensure-no-reserved-event-attrs! attrs)
   (event-internal
    n (assoc attrs :EventContext (k/event-context-attribute-name))
    true))
  ([schema]
   (parse-and-define event schema)))

(defn- intern-inferred-event [nm]
  (event nm cn/inferred-event-schema))

(defn ensure-event! [x]
  (if-let [n (li/record-name x)]
    (when-not (cn/find-event-schema n)
      (intern-inferred-event n))
    (u/throw-ex (str "not an event - " x))))

(defn ensure-dataflow-pattern! [x]
  (cond
    (keyword? x) (li/validate-name x)
    (or (map? x) (li/special-form? x) (symbol? x)) x
    :else (u/throw-ex (str "Invalid dataflow pattern. Possible syntax error - " x))))

(defn ensure-dataflow-patterns! [xs]
  (doseq [x xs] (ensure-dataflow-pattern! x)))

(declare normalize-event-pattern)

(defn- normalize-event-pattern-attribute [[k v]]
  (cond
    (map? v)
    [k (normalize-event-pattern v)]

    (symbol? v)
    [k `(quote ~v)]

    :else [k v]))

(defn- normalize-event-pattern [pattern]
  (if (map? pattern)
    (let [attrs (map normalize-event-pattern-attribute (first (vals pattern)))]
      (into {(first (keys pattern)) (into {} attrs)}))
    pattern))

(defn- extract-on-and-where [match-pat]
  (if (= (count match-pat) 7)
    (do
      (when-not (= :on (nth match-pat 3))
        (u/throw-ex (str ":on keyword not found - " match-pat)))
      (when-not (= :where (nth match-pat 5))
        (u/throw-ex (str ("where clause not found - " match-pat))))
      [(li/validate-on-clause (nth match-pat 4))
       (li/validate-where-clause (nth match-pat 6))])
    (u/throw-ex (str ":on and :where clauses expected - " match-pat))))

(defn- install-event-trigger-pattern [match-pat]
  (let [event-name (first match-pat)]
    (when-not (li/name? event-name)
      (u/throw-ex (str "not a valid event name - " event-name)))
    (when-not (= :when (second match-pat))
      (u/throw-ex (str "expected keyword :when not found - " match-pat)))
    (let [pat (nth match-pat 2)
          predic (rl/compile-rule-pattern pat)
          rnames (li/referenced-record-names pat)
          [on where] (when (> (count rnames) 1)
                       (extract-on-and-where match-pat))
          event-attrs (li/references-to-event-attributes rnames)
          evt-name (event event-name event-attrs)]
      (cn/install-triggers!
       (or on rnames)
       event-name predic where rnames)
      evt-name)))

(defn- concat-refs [n refs]
  (keyword (str (subs (str n) 1) "."
                (s/join "." (mapv name refs)))))

(defn- rewrite-on-event-patterns [pats recname evtname]
  (let [sn (li/split-path recname)
        refs-prefix [:Instance]]
    (w/postwalk
     #(if (li/name? %)
        (let [{c :component n :record
               p :path r :refs} (li/path-parts %)
              refs (seq r)
              cn [c n]]
          (if (or (= cn sn) (= sn (li/split-path p)))
            (if (not refs)
              (concat-refs evtname refs-prefix)
              (concat-refs evtname (concat refs-prefix refs)))
            %))
        %)
     pats)))

(defn- on-event-pattern? [x]
  (and (vector? x) (= :on (first x))))

(defn- translate-on-event-pattern [match-pat patterns]
  (if (= :update (second match-pat))
    (let [recname (nth match-pat 2)
          evtname (on-set-attrs-event-name recname)]
      [evtname (rewrite-on-event-patterns patterns recname evtname)])
    (u/throw-ex (str "invalid event trigger - " (second match-pat)))))

(defn dataflow
  "A declarative data transformation pipeline."
  [match-pat & patterns]
  (if (on-event-pattern? match-pat)
    (let [[mp ps] (translate-on-event-pattern match-pat patterns)]
      (apply dataflow mp ps))
    (do
      (ensure-dataflow-patterns! patterns)
      (if (vector? match-pat)
        (apply
         dataflow
         (install-event-trigger-pattern match-pat)
         patterns)
        (let [hd (:head match-pat)]
          (if-let [mt (and hd (:on-entity-event hd))]
            (cn/register-entity-dataflow mt hd patterns)
            (let [event (normalize-event-pattern (if hd (:on-event hd) match-pat))]
              (do (ensure-event! event)
                  (cn/register-dataflow event hd patterns)))))))))

(defn- crud-evname [entity-name evtname]
  (cn/canonical-type-name
   (keyword (str (name evtname) "_" (name entity-name)))))

(defn- crud-event-inst-accessor [evtname]
  (cn/canonical-type-name
   (keyword (str (name evtname) ".Instance"))))

(defn- id-accessor [evtname]
  (cn/canonical-type-name
   (keyword (str (name evtname) ".Instance.Id"))))

(defn- direct-id-accessor [evtname]
  (cn/canonical-type-name
   (keyword (str (name evtname) ".Id"))))

(defn- crud-event-delete-pattern [evtname entity-name]
  [:delete entity-name (direct-id-accessor evtname)])

(defn- crud-event-lookup-pattern [evtname entity-name]
  {entity-name {:Id? (direct-id-accessor evtname)}})

(defn- implicit-entity-event-dfexp
  "Construct a dataflow expressions for an implicit dataflow
  lifted from the :on-entity-event property of an entity
  definition."
  [ename event-spec]
  `(dataflow {:head {:on-entity-event {~ename {:Id 'aaaaid}}
                     :when ~(:when event-spec)}}
             ~@(:do event-spec)))

(defn- lift-implicit-entity-events
  "Pick out the :on-entity-event definitions from the attributes
  into independent dataflows."
  [ename attrs]
  (if-let [especs (:on-entity-event attrs)]
    [(dissoc attrs :on-entity-event)
     (map (partial implicit-entity-event-dfexp ename) especs)]
    [attrs nil]))

(defn- entity-event [entity-name event-name event-type _]
  (let [attrs (if (= event-type :OnDelete)
                {:Instance entity-name}
                {:Instance entity-name
                 :OldInstance entity-name})]
    (event-internal event-name attrs)))

(defn- maybe-assoc-id [entity-name attrs]
  (if (cn/entity-schema-predefined? entity-name)
    attrs
    (assoc
     attrs :Id
     (cn/canonical-type-name :Id))))

(defn- load-ref-pattern [evt-name evt-ref entity-name attr-name attr-schema]
  (let [[c _] (li/split-path entity-name)
        r (:ref attr-schema)]
    {(li/make-path (:component r) (:record r))
     {(keyword (str (name (first (:refs r))) "?"))
      (keyword (str (name c) "/" (name evt-name) "." (name evt-ref) "." (name attr-name)))}}))

(defn entity
  "A record that can be persisted with a unique id."
  ([n attrs]
   (if (map? attrs)
     (let [entity-name (validated-canonical-type-name n)
           [attrs dfexps] (lift-implicit-entity-events entity-name attrs)
           result (cn/intern-entity
                    entity-name
                    (normalized-attributes
                      :entity
                      entity-name
                      (maybe-assoc-id entity-name attrs)))
           ev (partial crud-evname n)
           ctx-aname (k/event-context-attribute-name)
           inst-evattrs {:Instance n :EventContext ctx-aname}
           id-evattrs {:Id :Kernel/UUID :EventContext ctx-aname}]
       ;; Define CRUD events and dataflows:
       (let [upevt (ev :Upsert)
             delevt (ev :Delete)
             lookupevt (ev :Lookup)]
         (cn/for-each-entity-event-name
           entity-name
           (partial entity-event entity-name))
         (event-internal
          (on-set-attrs-event-name entity-name)
          inst-evattrs)
         (event-internal upevt inst-evattrs)
         (let [ref-pats (mapv (fn [[k v]]
                                (load-ref-pattern
                                 upevt :Instance entity-name k
                                 (cn/find-attribute-schema v)))
                              (cn/ref-attribute-schemas
                               (cn/fetch-schema entity-name)))]
           (cn/register-dataflow upevt `[~@ref-pats ~(crud-event-inst-accessor upevt)]))
         (event-internal delevt id-evattrs)
         (cn/register-dataflow delevt [(crud-event-delete-pattern delevt entity-name)])
         (event-internal lookupevt id-evattrs)
         (cn/register-dataflow lookupevt [(crud-event-lookup-pattern lookupevt entity-name)]))
       ;; Install dataflows for implicit events.
       (when dfexps (doall (map eval dfexps)))
       result)
     (u/throw-ex (str "Syntax error in entity. Check entity: " n))))
  ([schema] (parse-and-define entity schema)))

(defn- resolver-for-entity [component ename spec]
  (if (cn/find-entity-schema ename)
    (cn/install-resolver component ename spec)
    (u/throw-ex (str "cannot install resolver, schema not found for " ename))))

(defn- resolver-for-component [component spec]
  (if (cn/component-exists? component)
    (cn/install-resolver component spec)
    (u/throw-ex (str "cannot install resolver, component not found - " component))))

(def ^:private resolver-keys #{:type :compose? :config})

(defn- validate-resolver-spec [spec]
  (if (and (map? spec)
           (= resolver-keys
              (set/union resolver-keys
                         (keys spec))))
    spec
    (u/throw-ex (str "invalid key(s) in resolver spec - "
                     (set/difference (set (keys spec))
                                     resolver-keys)))))

(defn resolver
  "Add a resolver for a component or entity.
  Target should be fully-qualified name of a component or entity."
  [target spec]
  (let [spec (validate-resolver-spec spec)
        [a b] (li/split-path target)]
    (if (and a b)
      (resolver-for-entity a b spec)
      (resolver-for-component target spec))))

(def ^:private kernel-inited
  #?(:clj
     (ref false)
     :cljs
     (atom false)))

(defn- do-init-kernel []
  (cn/create-component :Kernel {})
  (doseq [[type-name type-def] k/types]
    (attribute type-name type-def))

  (attribute (k/event-context-attribute-name)
             (k/event-context-attribute-schema))

  (attribute :Kernel/Password
             {:type :Kernel/String
              :secure-hash true})

  (record :Kernel/Future
          {:Result :Kernel/Any
           :TimeoutMillis {:type :Kernel/Int
                           :default 2000}})

  (entity :Kernel/OAuthAnyRequest
       {:ClientID :Kernel/String
        :ClientSecret :Kernel/String
        :ApiToken {:type :Kernel/String :optional true}
        :AuthDomain :Kernel/String
        :Email :Kernel/String
        :UserName :Kernel/String
        :Password :Kernel/String})
  
  (entity {:Kernel/Resolver
           {:Type :Kernel/Keyword
            :Configuration :Kernel/Map
            :Identifier {:check keyword? :unique true}}})
  
  (entity {:Kernel/Auth0User
           {:UserName :Kernel/String
            :Email :Kernel/String
            :UserEmail {:type :Kernel/String :optional true}
            :UserId {:type :Kernel/String :optional true}            
            :Password :Kernel/String
            :UserInfo {:type :Kernel/Map :optional true}
            :RequestObject {:type :Kernel/OAuthAnyRequest :optional true}}})
                                                          
  (entity {:Kernel/Authentication
           {:Owner {:type :Kernel/Any :optional true}
            :AuthType {:oneof ["Database" "Auth0Database" "OAuth2Request"]
                       :default "Database"}
            :RequestObject {:type :Kernel/Map :optional true}
            :Issued {:type :Kernel/DateTime :optional true}
            :ExpirySeconds {:type :Kernel/Int :default 300}}})

  (entity {:Kernel/AuthResponse
           {:AccessToken :Kernel/String
            :IdToken :Kernel/String
            :RefreshToken {:type :Kernel/String :optional true}
            :TokenType :Kernel/String
            :Owner :Kernel/String
            :Issued {:type :Kernel/DateTime :optional true}
            :ExpirySeconds {:type :Kernel/Int :default 86400}}})

  (entity {:Kernel/Policy
           {:Intercept :Kernel/String
            :Resource {:listof :Kernel/Path}
            :Rule :Kernel/Any
            :Trigger {:type :Kernel/Path :optional true}
            :InterceptStage {:oneof [:PreEval :PostEval :Default]
                             :default :Default}}})

  (entity {:Kernel/Timer
           {:Expiry :Kernel/Int
            :ExpiryUnit {:oneof [:Seconds :Minutes :Hours :Days]
                         :default :Seconds}
            :ExpiryEvent :Kernel/Map
            ;; :TaskHandle is set by the runtime, represents the
            ;; thread that execute the event after timer expiry.
            :TaskHandle {:type :Kernel/Any :optional true}}})

  (event :Kernel/AppInit
         {:Data :Kernel/Map})

  #?(:clj
     (do
       (cn/create-component :Git {})
       (cn/create-component :Email {})
       (cn/create-component :Sms {})

       (event :Git/Push
              {:Path :Kernel/String})

       (event :Email/Push
              {:Backend :Kernel/String
               :Receiver :Kernel/Email
               :Subject :Kernel/String
               :Text :Kernel/String})

       (event :Sms/Push
              {:To :Kernel/String
               :Body :Kernel/String})

       (record :Kernel/DataSource
               {:Uri {:type :Kernel/String
                      :optional true} ;; defaults to currently active store
                :Entity :Kernel/Path ;; name of an entity
                :AttributeMapping {:type :Kernel/Map
                                   :optional true}})

       (event :Kernel/DataSync
              {:Source :Kernel/DataSource
               :DestinationUri {:type :Kernel/String
                                :optional true}})

       (r/register-resolvers
        [{:name :policy
          :type :policy
          :compose? false
          :paths [:Kernel/Policy]}
         {:name :auth
          :type :auth
          :compose? false
          :paths [:Kernel/Authentication]}
         {:name :auth0-user
          :type :auth0-user
          :compose? true
          :paths [:Kernel/Auth0User]}
         {:name :timer
          :type :timer
          :compose? false
          :paths [:Kernel/Timer]}
         {:name :git
          :type :git
          :compose? false
          :paths [:Git/Push]}
         {:name :data-sync
          :type :data-sync
          :compose? false
          :paths [:Kernel/DataSync]}
         {:name :email
          :type :email
          :compose? false
          :paths [:Email/Push]}
         {:name :sms
          :type :sms
          :compose? false
          :paths [:Sms/Push]}]))))

(defn- initf []
  (when-not @kernel-inited
    (do-init-kernel)
    true))

(defn init []
  (u/safe-set-truth kernel-inited initf))
