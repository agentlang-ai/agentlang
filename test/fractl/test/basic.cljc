(ns fractl.test.basic
  (:require #?(:clj [clojure.test :refer [deftest is testing]]
               :cljs [cljs.test :refer-macros [deftest is testing]])
            [fractl.util :as u]
            [fractl.util.hash :as sh]
            [fractl.store :as store]
            [fractl.component :as cn]
            [fractl.compiler :as c]
            [fractl.lang
             :as ln
             :refer [component attribute event
                     entity record dataflow]]
            [fractl.evaluator :as e]
            [fractl.lang.opcode :as opc]
            [fractl.compiler.context :as ctx]
            [fractl.lang.datetime :as dt]
            #?(:clj [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])))

#? (:clj
    (def store (store/open-default-store nil))
    :cljs
    (def store (store/open-default-store {:type :reagent})))

(defn- install-test-component []
  (cn/remove-component :CompileTest)
  (component :CompileTest)
  (entity {:CompileTest/E1
           {:X :Int
            :Y :Int}}))

(defn- init-test-context []
  (install-test-component)
  (let [ctx (c/make-context)
        f (partial store/compile-query store)]
    (ctx/bind-compile-query-fn! ctx f)
    ctx))

(defn- compile-pattern [ctx pat]
  (:opcode (c/compile-pattern ctx pat)))

(defn- pattern-compiler []
  (let [ctx (init-test-context)]
    [ctx (partial compile-pattern ctx)]))

(defn- valid-opcode? [opc-predic opcode v]
  (is (opc-predic opcode))
  (if (fn? v)
    (is (v (opc/arg opcode)))
    (is (= v (opc/arg opcode)))))

(defn- valid-opcode-with-query? [opcode farg]
  (is (opc/query-instances? opcode))
  (let [arg (opc/arg opcode)]
    (is (= farg (first arg)))))

(def ^:private load-instance? (partial valid-opcode? opc/load-instance?))
(def ^:private match-inst? (partial valid-opcode? opc/match-instance?))

(deftest compile-path
  (let [[_ c] (pattern-compiler)
        p1 :CompileTest/E1
        p1e :CompileTest/E111
        p2 :CompileTest/Create_E1
        p2e :CompileTest/Update_E111]
    (load-instance? (c p1) [[:CompileTest :E1] nil])
    (tu/is-error #(c p1e))
    (load-instance? (c p2) [[:CompileTest :Create_E1] nil])
    (tu/is-error #(c p2e))))

(deftest compile-pattern-01
  (let [[_ c] (pattern-compiler)
        p1 {:CompileTest/E1
            {:X 100
             :Y 200}}
        opcs (c p1)]
    (is (valid-opcode? opc/new-instance?
                       (first opcs) [:CompileTest :E1]))
    (is (valid-opcode? opc/set-literal-attribute?
                       (second opcs) [:X 100]))
    (is (valid-opcode? opc/set-literal-attribute?
                       (nth opcs 2) [:Y 200]))
    (is (valid-opcode? opc/intern-instance?
                       (nth opcs 3) [[:CompileTest :E1] nil true true]))))

(deftest compile-pattern-02
  (let [[ctx c] (pattern-compiler)
        p1 {:CompileTest/E1
            {tu/q-id-attr 'id
             :X 100
             :Y '(+ :X 10)}}
        uuid (u/uuid-string)]
    ;; Variable `id` not in context.
    (tu/is-error #(c p1))
    ;; Any value will do, variable validation
    ;; will happen only during runtime.
    ;; In this case, the variable is resolved at
    ;; compile-time itself.
    (ctx/bind-variable! ctx 'id uuid)
    (let [opcs (c p1)]
      (is (valid-opcode-with-query? (first opcs) [:CompileTest :E1]))
      (is (valid-opcode? opc/set-literal-attribute?
                         (second opcs) [:X 100]))
      (is (valid-opcode? opc/set-compound-attribute?
                         (nth opcs 2) (fn [[n f]]
                                        (and (= :Y n) (fn? f)))))
      (is (valid-opcode? opc/intern-instance?
                         (nth opcs 3) [[:CompileTest :E1] nil true true])))))

(deftest circular-dependency
  (let [[ctx c] (pattern-compiler)
        p1 {:CompileTest/E1
            {tu/q-id-attr 'id
             :X '(+ :Y 20)
             :Y '(+ :X 10)}}
        uuid (u/uuid-string)]
    (ctx/bind-variable! ctx 'id uuid)
    ;; Compilation fail on cyclic-dependency
    (tu/is-error #(c p1))))

(deftest compile-ref
  (defcomponent :Df01
    (entity {:Df01/E
             {:X :Int
              :Y :Int}}))
  (let [e (cn/make-instance :Df01/E {:X 10 :Y 20})
        evt {:Df01/Create_E {:Instance e}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/same-instance? e result))))

(deftest compile-create
  (defcomponent :Df02
    (entity {:Df02/E
             {:X :Int
              :Y :Int}})
    (record {:Df02/R {:A :Int}})
    (event {:Df02/PostE {:R :Df02/R}}))
  (dataflow :Df02/PostE
            {:Df02/E {:X :Df02/PostE.R.A
                      :Y '(* :X 10)}})
  (let [r (cn/make-instance :Df02/R {:A 100})
        evt (cn/make-instance :Df02/PostE {:R r})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Df02/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= 100 (:X result)))
    (is (= 1000 (:Y result)))))

(deftest dependency
  (defcomponent :Df03
    (record {:Df03/R {:A :Int}})
    (entity {:Df03/E {:X :Int
                      :Y :Int
                      :Z :Int}})
    (event {:Df03/PostE {:R :Df03/R}}))
  (dataflow :Df03/PostE
            {:Df03/E {:X :Df03/PostE.R.A
                      :Z '(+ :X :Y)
                      :Y '(* :X 10)}})
  (let [r (cn/make-instance :Df03/R {:A 100})
        evt {:Df03/PostE {:R r}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Df03/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= 100 (:X result)))
    (is (= 1000 (:Y result)))
    (is (= 1100 (:Z result)))))

(deftest boolean-type
  (defcomponent :Bool
    (entity {:Bool/E {:X :Boolean
                      :Y :Boolean}})
    (event {:Bool/PostE1 {:B :Boolean}})
    (event {:Bool/PostE2 {:B :Boolean}}))
  (dataflow :Bool/PostE1
            {:Bool/E {:X :Bool/PostE1.B
                      :Y true}})
  (dataflow :Bool/PostE2
            {:Bool/E {:X :Bool/PostE2.B
                      :Y false}})
  (let [evt (cn/make-instance :Bool/PostE1 {:B true})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Bool/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= true (:X result)))
    (is (= true (:Y result))))
  (let [evt (cn/make-instance :Bool/PostE2 {:B false})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Bool/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= false (:X result)))
    (is (= false (:Y result)))))

(deftest self-reference
  (defcomponent :SelfRef
    (entity {:SelfRef/E
             {:X :Int
              :Y :Int
              :Z :Int}})
    (event {:SelfRef/AddToX {:EId :UUID
                             :Y :Int}}))
  (dataflow :SelfRef/AddToX
            {:SelfRef/E {tu/q-id-attr :SelfRef/AddToX.EId
                         :X '(+ :X :SelfRef/AddToX.Y)
                         :Y :SelfRef/AddToX.Y
                         :Z 1}})
  (let [e (cn/make-instance :SelfRef/E {:X 100 :Y 200 :Z 300})
        evt (cn/make-instance :SelfRef/Create_E {:Instance e})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :SelfRef/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= 100 (:X result)))
    (is (= 200 (:Y result)))
    (is (= 300 (:Z result)))
    (let [id (cn/id-attr result)
          addevt (cn/make-instance :SelfRef/AddToX {:EId id :Y 10})
          result (first (tu/fresult (e/eval-all-dataflows addevt)))
          inst result]
      (is (cn/instance-of? :SelfRef/E inst))
      (is (u/uuid-from-string (cn/id-attr inst)))
      (is (= 110 (:X inst)))
      (is (= 10 (:Y inst)))
      (is (= 1 (:Z inst))))))

(deftest compound-attributes
  (defcomponent :Df04
    (entity {:Df04/E1 {:A :Int}})
    (entity {:Df04/E2 {:AId {:ref (tu/append-id :Df04/E1)}
                       :X :Int
                       :Y {:type :Int
                           :expr '(* :X :AId.A)}}})
    (event {:Df04/PostE2 {:E1 :Df04/E1}}))
  (dataflow :Df04/PostE2
            {:Df04/E2 {:AId (tu/append-id :Df04/PostE2.E1)
                       :X 500}})
  (let [e (cn/make-instance :Df04/E1 {:A 100})
        evt (cn/make-instance :Df04/Create_E1 {:Instance e})
        e1 (first (tu/fresult (e/eval-all-dataflows evt)))
        id (cn/id-attr e1)
        e2 (cn/make-instance :Df04/E2 {:AId (cn/id-attr e1)
                                       :X 20})
        evt (cn/make-instance :Df04/PostE2 {:E1 e1})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Df04/E2 result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= (:AId result) id))
    (is (= (:X result) 500))
    (is (= (:Y result) 50000))))

(deftest compound-attributes-non-id
  (defcomponent :Df04NID
    (entity {:Df04NID/E1 {:A :Int
                          :Name {:type :String
                                 :unique true}}})
    (entity {:Df04NID/E2 {:E1 {:ref :Df04NID/E1.Name}
                          :X :Int
                          :Y {:type :Int
                              :expr '(* :X :E1.A)}}})
    (event {:Df04NID/PostE2 {:E1Name :String}}))
  (dataflow :Df04NID/PostE2
            {:Df04NID/E2 {:E1 :Df04NID/PostE2.E1Name
                          :X 500}})
  (let [e (cn/make-instance :Df04NID/E1 {:A 100
                                         :Name "E1-A"})
        evt (cn/make-instance :Df04NID/Create_E1 {:Instance e})
        e1 (first (tu/fresult (e/eval-all-dataflows evt)))
        e1-name (:Name e1)
        evt (cn/make-instance :Df04NID/PostE2 {:E1Name e1-name})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Df04NID/E2 result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= (:E1 result) e1-name))
    (is (= (:X result) 500))
    (is (= (:Y result) 50000))))

(defn- assert-ca-e! [result]
  (is (cn/instance-of? :CA/E result))
  (is (= 20 (:A result)))
  (is (= 200 (:B result))))

(deftest compound-attributes-with-default-events
  (defcomponent :CA
    (entity {:CA/E {:A :Int
                    :B {:type :Int
                        :expr '(* :A 10)}}}))
  (let [e (cn/make-instance :CA/E {:A 20})
        evt {:CA/Create_E {:Instance e}}
        r (e/eval-all-dataflows evt)
        result (first (tu/fresult r))]
    (assert-ca-e! result)
    (let [id (cn/id-attr result)
          evt {:CA/Lookup_E {cn/id-attr id}}
          r (e/eval-all-dataflows evt)
          result (first (tu/fresult r))]
      (assert-ca-e! result))))

(deftest compound-attributes-literal-arg
  (defcomponent :Df041
    (record {:Df041/R {:A :Int}})
    (entity {:Df041/E {:X :Int
                       :Y {:type :Int
                           :expr '(* :X 10)}}})
    (event {:Df041/PostE {:R :Df041/R}}))
  (dataflow :Df041/PostE
            {:Df041/E {:X :Df041/PostE.R.A}})
  (let [r (cn/make-instance :Df041/R {:A 100})
        evt (cn/make-instance :Df041/PostE {:R r})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Df041/E result))
    (is (= (:X result) 100))
    (is (= (:Y result) 1000))))

(deftest fire-event
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :Df05
     (entity {:Df05/E1 {:A :Int}})
     (entity {:Df05/E2 {:B :Int}})
     (event {:Df05/Evt01 {:E1 :Df05/E1}})
     (event {:Df05/Evt02 {:E1 :Df05/E1}})
     (dataflow :Df05/Evt01
               {:Df05/Evt02 {:E1 :Df05/Evt01.E1}})
     (dataflow :Df05/Evt02
               {:Df05/E2 {:B :Df05/Evt02.E1.A}}))
   (let [e1 (cn/make-instance :Df05/E1 {:A 100})
         evt {:Df05/Evt01 {:E1 e1}}
         result (first (tu/fresult (e/eval-all-dataflows evt)))]
     (is (cn/instance-of? :Df05/E2 result))
     (is (= (:B result) 100)))))

(deftest refcheck
  (defcomponent :RefCheck
    (entity {:RefCheck/E1 {:A :Int}})
    (entity {:RefCheck/E2 {:AId {:ref (tu/append-id :RefCheck/E1)}
                           :X :Int}}))
  (let [e (cn/make-instance :RefCheck/E1 {:A 100})
        id (cn/id-attr e)
        e2 (cn/make-instance :RefCheck/E2 {:AId (cn/id-attr e) :X 20})
        evt (cn/make-instance :RefCheck/Create_E2 {:Instance e2})]
    (is (= :not-found (:status (first (e/eval-all-dataflows evt)))))
    (let [evt (cn/make-instance :RefCheck/Create_E1 {:Instance e})
          e1 (first (tu/fresult (e/eval-all-dataflows evt)))
          id (cn/id-attr e1)
          e2 (cn/make-instance :RefCheck/E2 {:AId (cn/id-attr e1) :X 20})
          evt (cn/make-instance :RefCheck/Create_E2 {:Instance e2})
          inst (first (tu/fresult (e/eval-all-dataflows evt)))]
      (is (cn/instance-of? :RefCheck/E2 inst))
      (is (= (:AId inst) id)))))

(deftest s3-test
  (defcomponent :AWS
    (record {:AWS/CreateBucketConfig
             {:LocationConstraint :String}})
    (entity {:AWS/S3Bucket
             {:Bucket :String
              :CreateBucketConfiguration :AWS/CreateBucketConfig}})
    (event {:AWS/CreateBucket
            {:Bucket :String
             :Region :String}}))
  (dataflow :AWS/CreateBucket
            {:AWS/CreateBucketConfig {:LocationConstraint :AWS/CreateBucket.Region}}
            {:AWS/S3Bucket {:Bucket :AWS/CreateBucket.Bucket
                            :CreateBucketConfiguration :AWS/CreateBucketConfig}})
  ;(override-test-resolver :AWSS3Resolver :AWS/S3Bucket)
  (let [bucket "ftltestbucket11"
        region "us-east-1"
        evt {:AWS/CreateBucket {:Bucket bucket :Region region}}
        e1 (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :AWS/S3Bucket e1))
    (is (= bucket (:Bucket e1)))
    (is (cn/instance-of? :AWS/CreateBucketConfig (:CreateBucketConfiguration e1)))
    (is (= region (get-in e1 [:CreateBucketConfiguration :LocationConstraint])))))

(deftest record-in-entity
  (defcomponent :RecordEnt
    (record {:RecordEnt/R {:A :Int}})
    (entity {:RecordEnt/E {:Q :Int
                           :R :RecordEnt/R}})
    (event {:RecordEnt/PostE {:RA :Int}}))
  (dataflow :RecordEnt/PostE
            {:RecordEnt/R {:A :RecordEnt/PostE.RA}}
            {:RecordEnt/E {:Q 100
                           :R :RecordEnt/R}})
  (let [evt {:RecordEnt/PostE {:RA 10}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :RecordEnt/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= 100 (:Q result)))
    (is (= 10 (:A (:R result))))))

(deftest hidden-attributes
  (defcomponent :H
    (entity {:H/E {:A :Int
                   :X {:type :String
                       :secure-hash true
                       :write-only true}}}))
  (let [x "this is a secret"
        e (cn/make-instance :H/E {:A 10 :X x})
        evt {:H/Create_E {:Instance e}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))
        r2 (cn/dissoc-write-only result)]
    (is (cn/instance-of? :H/E result))
    (is (sh/crypto-hash-eq? (:X result) x))
    (is (= 10 (:A result)))
    (is (cn/instance-of? :H/E r2))
    (is (not (:X r2)))
    (is (= 10 (:A r2)))))

(deftest alias-for-instances
  (defcomponent :Alias
    (entity {:Alias/E {:X :Int}})
    (entity {:Alias/F {:Y :Int}})
    (record {:Alias/R {:F :Alias/F}})
    (event {:Alias/Evt {:Instance :Alias/E}})
    (dataflow :Alias/Evt
              {:Alias/F {:Y :Alias/Evt.Instance.X} :as :G}
              {:Alias/R {:F :G}}))
  (let [e (cn/make-instance :Alias/E {:X 100})
        evt (cn/make-instance :Alias/Evt {:Instance e})
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Alias/R result))
    (is (cn/instance-of? :Alias/F (:F result)))
    (is (= 100 (get-in result [:F :Y])))))

(deftest multi-alias
  (defcomponent :MultiAlias
    (entity {:MultiAlias/E {:X :Int}})
    (entity {:MultiAlias/F {:A :Int
                            :B :Int}})
    (event {:MultiAlias/Evt {:EX1 :Int
                             :EX2 :Int}})
    (dataflow :MultiAlias/Evt
              {:MultiAlias/E {:X :MultiAlias/Evt.EX1} :as :E1}
              {:MultiAlias/E {:X :MultiAlias/Evt.EX2} :as :E2}
              {:MultiAlias/F {:A :E1.X :B :E2.X}}))
  (let [evt {:MultiAlias/Evt {:EX1 100 :EX2 10}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :MultiAlias/F result))
    (is (= 100 (:A result)))
    (is (= 10 (:B result)))))

(defn- conditional-event-01 [i x]
  (let [evt {:Cond/Evt {:I i}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :Cond/R result))
    (is (= x (:X result)))))

(defn- conditional-event-02 [r predic]
  (let [evt {:Cond/EvtWithInst {:R r}}
        result (tu/fresult (e/eval-all-dataflows evt))]
    (is (predic result))))

(deftest conditional
  (defcomponent :Cond
    (record {:Cond/R {:X :Int}})
    (event {:Cond/Evt {:I :Int}})
    (dataflow :Cond/Evt
              [:match :Cond/Evt.I
               0 {:Cond/R {:X 100}}
               1 {:Cond/R {:X 200}}
               {:Cond/R {:X 300}}])
    (event {:Cond/EvtWithInst {:R :Cond/R}})
    (dataflow :Cond/EvtWithInst
              {:Cond/R {:X 100} :as :R1}
              [:match :Cond/EvtWithInst.R.X
               :R1.X true]))
  (conditional-event-01 0 100)
  (conditional-event-01 1 200)
  (conditional-event-01 3 300)
  (conditional-event-02 (cn/make-instance :Cond/R {:X 200}) false?)
  (conditional-event-02 (cn/make-instance :Cond/R {:X 100}) true?))

(deftest conditional-boolean
  (defcomponent :CondBool
    (record {:CondBool/R {:X :Int}})
    (event {:CondBool/Evt {:I :Boolean}})
    (dataflow :CondBool/Evt
              [:match :CondBool/Evt.I
               true {:CondBool/R {:X 100}}
               false {:CondBool/R {:X 200}}
               {:CondBool/R {:X 300}}]))
  (let [evt {:CondBool/Evt {:I true}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :CondBool/R result))
    (is (= 100 (:X result))))
  (let [evt {:CondBool/Evt {:I false}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :CondBool/R result))
    (is (= 200 (:X result)))))

(deftest conditional-pattern-list
  (defcomponent :CondPatList
    (record {:CondPatList/R {:X :Int}})
    (event {:CondPatList/Evt {:I :Int}})
    (dataflow :CondPatList/Evt
              [:match :CondPatList/Evt.I
               0 [{:CondPatList/R {:X 100}}
                  {:CondPatList/R {:X 101}}]
               1 {:CondPatList/R {:X 200}}
               {:CondPatList/R {:X 300}}]))
  (let [evt {:CondPatList/Evt {:I 0}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :CondPatList/R result))
    (is (= 101 (:X result))))
  (let [evt {:CondPatList/Evt {:I 1}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :CondPatList/R result))
    (is (= 200 (:X result)))))

(deftest match-with-alias
  (defcomponent :MA
    (record {:MA/R {:X :Int}})
    (event {:MA/Evt {:I :Int}})
    (dataflow :MA/Evt
              [:match :MA/Evt.I
               0 {:MA/R {:X 100}}
               1 {:MA/R {:X 200}}
               {:MA/R {:X 300}} :as :K]
              :K))
  (let [r01 (first (tu/fresult (e/eval-all-dataflows {:MA/Evt {:I 1}})))
        r02 (first (tu/fresult (e/eval-all-dataflows {:MA/Evt {:I 0}})))
        r03 (first (tu/fresult (e/eval-all-dataflows {:MA/Evt {:I 3}})))]
    (is (cn/instance-of? :MA/R r01))
    (is (= 200 (:X r01)))
    (is (cn/instance-of? :MA/R r02))
    (is (= 100 (:X r02)))
    (is (cn/instance-of? :MA/R r03))
    (is (= 300 (:X r03)))))

(deftest match-with-alias-no-alternative-case
  (defcomponent :MA2
    (record {:MA2/R {:X :Int}})
    (event {:MA2/Evt {:I :Int}})
    (dataflow :MA2/Evt
              [:match :MA2/Evt.I
               0 {:MA2/R {:X 100}}
               1 {:MA2/R {:X 200}} :as :K]
              :K))
  (let [r01 (first (tu/fresult (e/eval-all-dataflows {:MA2/Evt {:I 1}})))
        r02 (first (tu/fresult (e/eval-all-dataflows {:MA2/Evt {:I 0}})))
        r03 (first (tu/fresult (e/eval-all-dataflows {:MA2/Evt {:I 2}})))]
    (is (cn/instance-of? :MA2/R r01))
    (is (= 200 (:X r01)))
    (is (cn/instance-of? :MA2/R r02))
    (is (= 100 (:X r02)))))

(deftest alias-scope
  (defcomponent :AScope
    (entity {:AScope/E {:X :Int}})
    (record {:AScope/R {:A :Int :B :Int}})
    (event {:AScope/Evt {:I :Int}})
    (dataflow :AScope/Evt
              {:AScope/E {:X :AScope/Evt.I} :as :E1}
              {:AScope/E {:X '(+ :E1.X 1)} :as :E2}
              {:AScope/R {:A :E1.X :B :E2.X}}))
  (let [result (first (tu/fresult (e/eval-all-dataflows {:AScope/Evt {:I 10}})))]
    (is (cn/instance-of? :AScope/R result))
    (is (= 10 (:A result)))
    (is (= 11 (:B result)))))

(deftest for-each
  (defcomponent :ForEach
    (entity {:ForEach/E {:X :Int}})
    (record {:ForEach/R {:A :Int}})
    (event {:ForEach/Evt {:I :Int}})
    (dataflow :ForEach/Evt
              {:ForEach/E {:X :ForEach/Evt.I} :as :E1}
              {:ForEach/E {:X '(+ :E1.X 1)} :as :E2}
              [:for-each :ForEach/E?
               {:ForEach/R {:A :ForEach/E.X}}]))
  (let [result (tu/fresult (e/eval-all-dataflows {:ForEach/Evt {:I 10}}))
        firstE (first result)
        secondE (second result)]
    (is (= 2 (count result)))
    (is (cn/instance-of? :ForEach/R firstE))
    (is (= 10 (:A firstE)))
    (is (cn/instance-of? :ForEach/R secondE))
    (is (= 11 (:A secondE)))))

(deftest for-each-literal-result
  (defcomponent :ForEachLR
    (entity {:ForEachLR/E {:X :Int}})
    (record {:ForEachLR/R {:A :Int}})
    (event {:ForEachLR/Evt {:I :Int}})
    (dataflow :ForEachLR/Evt
              {:ForEachLR/E {:X :ForEachLR/Evt.I} :as :E1}
              {:ForEachLR/E {:X '(+ :E1.X 1)} :as :E2}
              [:for-each :ForEachLR/E?
               {:ForEachLR/R {:A :ForEachLR/E.X}}
               :ForEachLR/R.A]))
  (let [result (tu/fresult (e/eval-all-dataflows {:ForEachLR/Evt {:I 10}}))]
    (is (= 2 (count result)))
    (is (= 10 (first result)))
    (is (= 11 (second result)))))

(deftest for-each-basic-query
  (defcomponent :ForEachBQ
    (entity {:ForEachBQ/E {:X {:type :Int
                               :indexed true}}})
    (record {:ForEachBQ/R {:A :Int}})
    (event {:ForEachBQ/Evt {:I :Int}})
    (dataflow :ForEachBQ/Evt
              {:ForEachBQ/E {:X :ForEachBQ/Evt.I} :as :E1}
              {:ForEachBQ/E {:X '(+ :E1.X 1)} :as :E2}
              [:for-each {:ForEachBQ/E {:X? 10}}
               {:ForEachBQ/R {:A :ForEachBQ/E.X}}]))
  (let [result (tu/fresult (e/eval-all-dataflows {:ForEachBQ/Evt {:I 10}}))
        firstE (first result)]
    (is (= 1 (count result)))
    (is (cn/instance-of? :ForEachBQ/R firstE))
    (is (= 10 (:A firstE)))))

(deftest for-each-with-alias
  (defcomponent :ForEachAlias
    (entity {:ForEachAlias/E {:X :Int}})
    (record {:ForEachAlias/R {:A :Int}})
    (event {:ForEachAlias/Evt {:I :Int}})
    (dataflow :ForEachAlias/Evt
              {:ForEachAlias/E {:X :ForEachAlias/Evt.I} :as :E1}
              {:ForEachAlias/E {:X '(+ :E1.X 1)} :as :E2}
              [:for-each :ForEachAlias/E?
               {:ForEachAlias/R {:A :ForEachAlias/E.X}} :as :L]
              :L))
  (let [result (tu/fresult (e/eval-all-dataflows {:ForEachAlias/Evt {:I 10}}))
        firstE (first result)
        secondE (second result)]
    (is (= 2 (count result)))
    (is (cn/instance-of? :ForEachAlias/R firstE))
    (is (= 10 (:A firstE)))
    (is (cn/instance-of? :ForEachAlias/R secondE))
    (is (= 11 (:A secondE)))))

(deftest destructuring-alias
  (defcomponent :DestructuringAlias
    (entity {:DestructuringAlias/E {:X {:type    :Int
                                        :indexed true}
                                    :N :String}})
    (record {:Result {:Values :Any}})
    (event {:DestructuringAlias/Evt {:X :Int}})
     (dataflow :DestructuringAlias/Evt
      {:DestructuringAlias/E {:X? :DestructuringAlias/Evt.X} :as [:R1 :R2 :_ :R4 :& :RS]}
      {:DestructuringAlias/Result {:Values [:R1 :R2 :R4 :RS]}}))
  (let [es [(cn/make-instance :DestructuringAlias/E {:X 1 :N "e01"})
            (cn/make-instance :DestructuringAlias/E {:X 2 :N "e02"})
            (cn/make-instance :DestructuringAlias/E {:X 1 :N "e03"})
            (cn/make-instance :DestructuringAlias/E {:X 1 :N "e04"})
            (cn/make-instance :DestructuringAlias/E {:X 1 :N "e05"})
            (cn/make-instance :DestructuringAlias/E {:X 1 :N "e06"})
            (cn/make-instance :DestructuringAlias/E {:X 1 :N "e07"})]
        evts (map #(cn/make-instance :DestructuringAlias/Create_E {:Instance %}) es)
        _    (doall (map (comp (comp first tu/fresult)
                               #(e/eval-all-dataflows %))
                         evts))
        result (:Values (first (tu/fresult (e/eval-all-dataflows {:DestructuringAlias/Evt {:X 1}}))))]
    (is (and (= "e01" (:N (first result)))
             (= 1 (:X (first result)))))
    (is (= "e03" (:N (nth result 1))))
    (is (= 1 (:X (nth result 1))))
    (is (= "e05" (:N (nth result 2))))
    (is (= 1 (:X (nth result 2))))
    (is (= ["e06" "e07"] (map :N (last result))))
    (is (= [1 1] (map :X (last result))))))

(deftest delete-insts
  (defcomponent :Del
    (entity {:Del/E {:X :Int}}))
  (let [e (cn/make-instance :Del/E {:X 100})
        e01 (first (tu/fresult (e/eval-all-dataflows {:Del/Create_E {:Instance e}})))
        id (cn/id-attr e01)
        lookup-evt (cn/make-instance :Del/Lookup_E {cn/id-attr id})
        e02 (first (tu/fresult (e/eval-all-dataflows lookup-evt)))
        del-result (e/eval-all-dataflows {:Del/Delete_E {cn/id-attr id}})
        r01 (str (cn/id-attr (first (tu/fresult del-result))))
        r02 (e/eval-all-dataflows lookup-evt)]
    (is (cn/instance-of? :Del/E e01))
    (is (cn/same-instance? e01 e02))
    (is (= id r01))
    (is (= :not-found (:status (first r02))))))

(defn- assert-le
  ([n obj xs y]
   (is (cn/instance-of? n obj))
   (is (cn/id-attr obj))
   (is (= xs (:Xs obj)))
   (is (= y (:Y obj))))
  ([obj xs y] (assert-le :L/E obj xs y)))

(deftest listof
  (defcomponent :L
    (entity {:L/E {:Xs {:listof :Int}
                   :Y :Int}})
    (event {:L/MakeE0 {:Xs {:listof :Int} :Y :Int}})
    (dataflow :L/MakeE0
              {:L/E {:Xs :L/MakeE0.Xs :Y :L/MakeE0.Y}})
    (event {:L/MakeE1 {:X1 :Int :X2 :Int :Y :Int}})
    (dataflow :L/MakeE1
              {:L/E {:Xs [:L/MakeE1.X1 :L/MakeE1.X2] :Y :L/MakeE1.Y}})
    (event {:L/MakeE2 {:X :Int :Y :Int}})
    (dataflow :L/MakeE2
              {:L/E {:Xs [(* 100 2) 780 :L/MakeE2.X] :Y :L/MakeE2.Y}})
    (entity {:L/F {:Xs {:listof :Any}
                   :Y :Int}}))
  (let [e (cn/make-instance :L/E {:Xs [1 2 3] :Y 100})
        evt {:L/Create_E {:Instance e}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (assert-le result [1 2 3] 100))
  (let [evt {:L/MakeE0 {:Xs [10 20 30 40] :Y 1}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (assert-le result [10 20 30 40] 1))
  (try
    (let [evt {:L/MakeE0 {:Xs [10 "hi"] :Y 1}}
          result (tu/fresult (e/eval-all-dataflows evt))]
      (is (nil? result)))
    (catch #?(:clj Exception :cljs :default) ex
      (is ex)))
  (let [evt {:L/MakeE1 {:X1 10 :X2 20 :Y 1}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (assert-le result [10 20] 1))
  (let [evt {:L/MakeE2 {:X 10 :Y 90}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (assert-le result [200 780 10] 90))
  (let [e (cn/make-instance :L/F {:Xs [10 "hi"] :Y 1})
        evt {:L/Create_F {:Instance e}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (assert-le :L/F result [10 "hi"] 1)))

(deftest optional-attributes
  (defcomponent :OptAttr
    (entity {:OptAttr/E {:X :Int
                         :Y {:type :Int
                             :optional true}
                         :S :String}})
    (entity {:OptAttr/F {:X :Int
                         :Y :Int
                         :S :String
                         :meta {:required-attributes [:X :S]}}}))
  (let [e1 (cn/make-instance :OptAttr/E {:X 10 :S "hello"})
        e2 (cn/make-instance :OptAttr/E {:X 1 :Y 2 :S "hi"})]
    (is (cn/instance-of? :OptAttr/E e1))
    (is (= [10 nil "hello"] [(:X e1) (:Y e1) (:S e1)]))
    (is (cn/instance-of? :OptAttr/E e2))
    (is (= [1 2 "hi"] [(:X e2) (:Y e2) (:S e2)])))
  (let [f1 (cn/make-instance :OptAttr/F {:X 10 :S "hello"})
        f2 (cn/make-instance :OptAttr/F {:X 1 :Y 2 :S "hi"})]
    (is (cn/instance-of? :OptAttr/F f1))
    (is (= [10 nil "hello"] [(:X f1) (:Y f1) (:S f1)]))
    (is (cn/instance-of? :OptAttr/F f2))
    (is (= [1 2 "hi"] [(:X f2) (:Y f2) (:S f2)]))))

(deftest optional-record-attribute
  (defcomponent :OptRecAttr
    (record {:OptRecAttr/R {:A :Int}})
    (entity {:OptRecAttr/E {:Q :Int
                            :R {:type :OptRecAttr/R
                                :optional true}}})
    (event {:OptRecAttr/PostE {:Q :Int}}))
  (dataflow :OptRecAttr/PostE
            {:OptRecAttr/E {:Q :OptRecAttr/PostE.Q}})
  (let [evt {:OptRecAttr/PostE {:Q 10}}
        result (first (tu/fresult (e/eval-all-dataflows evt)))]
    (is (cn/instance-of? :OptRecAttr/E result))
    (is (u/uuid-from-string (cn/id-attr result)))
    (is (= 10 (:Q result)))))

(deftest inherits
  (defcomponent :Inherits
    (record {:Inherits/Base {:A {:type :Int
                                 :optional true}
                             :B :Int}})
    (entity {:Inherits/E {:meta {:inherits :Inherits/Base}
                          :X :Int
                          :Y {:type :Int
                              :optional true}
                          :S :String}})
    (record {:Inherits/BaseMeta {:A :Int
                                 :B :Int
                                 :meta {:required-attributes [:B]}}})
    (entity {:Inherits/F {:meta {:inherits :Inherits/BaseMeta}
                          :X :Int
                          :Y {:type :Int
                              :optional true}
                          :S :String}}))
  (let [e1 (cn/make-instance :Inherits/E {:X 10 :S "hello" :A 100 :B 200})
        e2 (cn/make-instance :Inherits/E {:X 1 :Y 2 :S "hi" :B 200})]
    (is (cn/instance-of? :Inherits/E e1))
    (is (= [10 nil "hello" 100 200] [(:X e1) (:Y e1) (:S e1) (:A e1) (:B e1)]))
    (is (cn/instance-of? :Inherits/E e2))
    (is (= [1 2 "hi" nil 200] [(:X e2) (:Y e2) (:S e2) (:A e2) (:B e2)])))
  (let [f1 (cn/make-instance :Inherits/F {:X 10 :S "hello" :A 100 :B 200})
        f2 (cn/make-instance :Inherits/F {:X 1 :Y 2 :S "hi" :B 200})]
    (is (cn/instance-of? :Inherits/F f1))
    (is (= [10 nil "hello" 100 200] [(:X f1) (:Y f1) (:S f1) (:A f1) (:B f1)]))
    (is (cn/instance-of? :Inherits/F f2))
    (is (= [1 2 "hi" nil 200] [(:X f2) (:Y f2) (:S f2) (:A f2) (:B f2)]))))

(deftest multi-level-inherits
  (defcomponent :MultiInherits
    (record {:MultiInherits/Base1 {:A {:type :Int
                                       :optional true}
                                   :B :Int}})
    (record {:MultiInherits/Base2 {:C :Int
                                   :meta {:inherits :MultiInherits/Base1}}})
    (entity {:MultiInherits/E {:X :Int
                               :Y {:type :Int
                                   :optional true}
                               :S :String
                               :meta {:inherits :MultiInherits/Base2}}}))
  (let [e1 (cn/make-instance :MultiInherits/E {:X 10 :S "hello" :A 100 :B 200 :C 300})
        e2 (cn/make-instance :MultiInherits/E {:X 1 :Y 2 :S "hi" :B 200 :C 300})]
    (is (cn/instance-of? :MultiInherits/E e1))
    (is (= [10 nil "hello" 100 200 300] [(:X e1) (:Y e1) (:S e1) (:A e1) (:B e1) (:C e1)]))
    (is (cn/instance-of? :MultiInherits/E e2))
    (is (= [1 2 "hi" nil 200 300] [(:X e2) (:Y e2) (:S e2) (:A e2) (:B e2) (:C e1)]))))

(deftest multi-level-inherits-meta
  (defcomponent :MultiInheritsMeta
    (record {:MultiInheritsMeta/Base1 {:A :Int
                                       :B :Int
                                       :meta {:required-attributes [:B]}}})
    (record {:MultiInheritsMeta/Base2 {:C :Int
                                       :meta {:inherits :MultiInheritsMeta/Base1}}})
    (entity {:MultiInheritsMeta/E {:X :Int
                                   :Y {:type :Int
                                       :optional true}
                                   :S :String
                                   :meta {:inherits :MultiInheritsMeta/Base2}}}))
  (let [e1 (cn/make-instance :MultiInheritsMeta/E {:X 10 :S "hello" :A 100 :B 200 :C 300})
        e2 (cn/make-instance :MultiInheritsMeta/E {:X 1 :Y 2 :S "hi" :B 200 :C 300})]
    (is (cn/instance-of? :MultiInheritsMeta/E e1))
    (is (= [10 nil "hello" 100 200 300] [(:X e1) (:Y e1) (:S e1) (:A e1) (:B e1) (:C e1)]))
    (is (cn/instance-of? :MultiInheritsMeta/E e2))
    (is (= [1 2 "hi" nil 200 300] [(:X e2) (:Y e2) (:S e2) (:A e2) (:B e2) (:C e1)]))))

(deftest edn-attribute
  (defcomponent :EdnAttr
    (entity :EdnAttr/Form {:Title :String
                           :X :Int
                           :Y {:type :Int
                               :expr '(+ :X 10)}
                           :View :Edn})
    (event :EdnAttr/RenderLoginForm {:Title :String
                                     :X :Int
                                     :Y :Int})
    (dataflow :EdnAttr/RenderLoginForm
              {:EdnAttr/Form
               {:Title :EdnAttr/RenderLoginForm.Title
                :X :EdnAttr/RenderLoginForm.X
                :View [:q#
                       [:div [:p [:b [:uq# :EdnAttr/RenderLoginForm.Title]]]
                        [:div
                         [:label "Username: "]
                         [:textinput [:size [:uq# '(* :EdnAttr/RenderLoginForm.Y 10)]]]]
                        [:div
                         [:label "Password: "]
                         [:password [:size 40]]]
                        [:div
                         [:submit [:text "Login"]]]]]}}))
  (let [result (first
                (tu/fresult
                 (e/eval-all-dataflows
                  {:EdnAttr/RenderLoginForm
                   {:Title "Login" :X 150 :Y 12}})))]
    (is (cn/instance-of? :EdnAttr/Form result))
    (is (= 160 (:Y result)))
    (is (= [:div [:p [:b "Login"]]]
           [(first (:View result))
            (second (:View result))]))
    (is (= 120 (-> (nthrest (:View result) 2)
                   first
                   (nth 2) second second)))))

(deftest patterns-in-attributes
  (defcomponent :PA
    (record {:PA/OnClickEvent {:Source {:type :Int :optional true}}})
    (record {:PA/Position {:X :Int :Y :Int
                           :W :Int :H :Int}})
    (entity {:PA/Button {:Id {:type :Int tu/guid true}
                         :Title :String
                         :Position :PA/Position
                         :OnClick :PA/OnClickEvent}})
    (event {:PA/AddButton {:Title :String :Position :PA/Position :Id :Int}})
    (dataflow :PA/AddButton
              {:PA/Button {:Id :PA/AddButton.Id
                           :Title :PA/AddButton.Title
                           :Position :PA/AddButton.Position
                           :OnClick
                           {:PA/OnClickEvent {:Source :PA/AddButton.Id}}}}))
  (let [pos (cn/make-instance {:PA/Position {:X 10 :Y 10 :W 100 :H 50}})
        add-btn (cn/make-instance {:PA/AddButton {:Title "OK" :Position pos :Id 1}})
        result (tu/first-result add-btn)]
    (is (cn/instance-of? :PA/Button result))
    (is (cn/instance-of? :PA/OnClickEvent (:OnClick result)))))

(deftest edn-ui
  (defcomponent :EdnUI
    (entity {:EdnUI/UserLogin
             {:UserNameLabel {:type :String
                              :default "Username: "}
              :PasswordLabel {:type :String
                              :default "Password: "}
              :ButtonTitle {:type :String
                            :default "Login"}
              :HandlerEvent {:type :Keyword
                             :optional true}
              :View {:type :Edn
                     :default
                     [:div
                      [:div
                       [:label :UserNameLabel]
                       [:input [:type "text"]]]
                      [:div
                       [:label :PasswordLabel]
                       [:input [:type "password"]]]
                      [:div
                       [:button [:title :ButtonTitle]
                        :on-click :HandlerEvent]]]}}})
    (entity {:EdnUI/LoginForm
             {:UserLogin {:type :EdnUI/UserLogin
                          :optional true}
              :Title {:type :String
                      :default "Login"}
              :DOMTarget :String
              :View {:type :Edn
                     :default
                     [:div
                      [:h2 :Title]
                      [:div :UserLogin.View]]}}})

    (event {:EdnUI/LoginEvent
            {:Data :Any}})

    (dataflow :EdnUI/MakeLoginForm
              {:EdnUI/UserLogin
               {:UserNameLabel :EdnUI/MakeLoginForm.UserNameLabel
                :PasswordLabel :EdnUI/MakeLoginForm.PasswordLabel
                :ButtonTitle :EdnUI/MakeLoginForm.ButtonTitle
                :HandlerEvent :EdnUI/MakeLoginForm.HandlerEvent}}
              {:EdnUI/LoginForm
               {:Title :EdnUI/MakeLoginForm.FormTitle
                :DOMTarget "app"
                :UserLogin :EdnUI/UserLogin}})
    (let [evt (cn/make-instance {:EdnUI/MakeLoginForm
                                 {:FormTitle "Login to the V8 Platform"
                                  :UserNameLabel "Your V8 userId or email: "
                                  :PasswordLabel "Password: "
                                  :ButtonTitle "Login"
                                  :HandlerEvent :EdnUI/LoginEvent}})
          result (first (tu/fresult (e/eval-all-dataflows evt)))]
      (is (cn/instance-of? :EdnUI/LoginForm result)))))

(deftest async-event
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :AE
     (record {:AE/R01 {:X :Int}})
     (event {:AE/Evt01 {:A :Int}})
     (event {:AE/Evt02 {:B :Int}})
     (dataflow :AE/Evt01
               {:AE/Evt02 {:B :AE/Evt01.A}})
     (dataflow :AE/Evt02
               {:AE/R01 {:X :AE/Evt02.B}}))
   (let [evt01 (cn/make-instance {:AE/Evt01 {:A 100}})
         result (first (tu/fresult (e/eval-all-dataflows evt01)))]
     (is (cn/instance-of? :AE/R01 result))
     (is (= 100 (:X result))))))

(deftest path-type
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :PathType
     (entity {:PathType/E
              {:X :Path}}))
   (let [e1 (cn/make-instance {:PathType/E {:X :A/B.R}})
         e2 (cn/make-instance {:PathType/E {:X "A/B.R"}})]
     (is (cn/instance-of? :PathType/E e1))
     (is (= :A/B.R (:X e1)))
     (is (cn/instance-of? :PathType/E e2))
     (is (= :A/B.R (keyword (:X e2))))
     (is (= "k/j" (:X (cn/make-instance {:PathType/E {:X "k/j"}}))))
     (is (= :k (:X (cn/make-instance {:PathType/E {:X :k}})))))))

(deftest format-test
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :FormatTest
     (entity {:FormatTest/E
              {:Phone {:type :String
                       :format "^(1\\s?)?(\\d{3}|\\(\\d{3}\\))[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$"}
               :DOB {:type :String
                     :format "^((19|2[0-9])[0-9]{2})-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])$"}}})
     (is (cn/instance-of?
          :FormatTest/E
          (cn/make-instance
           {:FormatTest/E
            {:Phone "(555)555-5555"
             :DOB "1999-03-20"}})))
     (tu/is-error #(cn/make-instance
                    {:FormatTest/E
                     {:Phone "(555)555-5555"
                      :DOB "1877-09-01"}})))))

(deftest numeric-types
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :NT
     (entity
      :NT/E
      {:X :Int
       :Y :Int64
       :Z :BigInteger
       :A :Float
       :B :Double
       :C :Decimal
       :D :DateTime})
     (let [bi 8993993938884848858996996
           f 1.2
           d "90.8"
           dt "2014-03-14T12:34:20.000000"
           e (cn/make-instance
              {:NT/E
               {:X 10
                :Y #?(:clj Long/MAX_VALUE
                      :cljs Number.MAX_VALUE)
                :Z bi
                :A f
                :B f
                :C d
                :D dt}})]
       (is (cn/instance-of? :NT/E e))
       (is (= 90.8M (:C e)))
       (is (= (float f) (:A e)))
       (is (= (double f) (:B e)))
       (is (= bi (:Z e)))
       (is (= dt (:D e)))))))

(deftest match-cond
  (#?(:clj do
      :cljs cljs.core.async/go)
   (defcomponent :MC
     (record
      {:MC/R
       {:X :Int}})
     (dataflow
      :MC/E
      [:match
       [:like :MC/E.Y "xyz%"] {:MC/R {:X 0}}
       [:< :MC/E.X 10] {:MC/R {:X 1}}
       [:= :MC/E.X 100] {:MC/R {:X 2}}
       [:between 1000 5000 :MC/E.X] {:MC/R {:X 100}}
       [:in [11 20 30] :MC/E.X] {:MC/R {:X 5}}
       [:or [:= 10 :MC/E.X] [:= 21 :MC/E.X]] {:MC/R {:X 12}}
       {:MC/R {:X 3}}
       :as :Result]
      :Result))
   (defn run [x result]
     (let [r (first
              (tu/fresult
               (e/eval-all-dataflows
                (cn/make-instance
                 {:MC/E
                  {:X x
                   :Y
                   (if (neg? x)
                     "xyz@eee.com"
                     "abc@ddsd.com")}}))))]
       (is (= (:X r) result))))
   (run 3000 100)
   (run 20 5)
   (run 21 12)
   (run -1 0)
   (run 100 2)
   (run 9 1)
   (run 22 3)))

(deftest inheritance-type-check
  (defcomponent :Itc
    (record
     :Itc/Base
     {:X :Int})
    (record
     :Itc/Child1
     {:meta {:inherits :Itc/Base}
      :Y :Int})
    (record
     :Itc/Child2
     {:meta {:inherits :Itc/Base}
      :Z :Int})
    (record
     :Itc/Child3
     {:meta {:inherits :Itc/Child1}
      :A :Int})
    (entity
     :Itc/E
     {:Vals {:listof :Itc/Base}}))
  (let [v1 (cn/make-instance {:Itc/Child1 {:X 1 :Y 2}})
        v2 (cn/make-instance {:Itc/Child2 {:X 10 :Z 20}})
        v3 (cn/make-instance {:Itc/Child3 {:X 9 :Y 8 :A 7}})
        e (cn/make-instance {:Itc/E
                             {:Vals [v1 v2 v3]}})
        result (first
                (tu/fresult
                 (e/eval-all-dataflows
                  (cn/make-instance
                   {:Itc/Create_E
                    {:Instance e}}))))]
    (is (cn/instance-of? :Itc/E result))
    (every? #(or (cn/instance-of? :Itc/Child1 %)
                 (cn/instance-of? :Itc/Child2 %)
                 (cn/instance-of? :Itc/Child3 %))
            (:Vals result))
    (every? (partial cn/instance-of? :Itc/Base) (:Vals result))))

#?(:clj
   (deftest check-wrong-reference-attribute-use
     (defcomponent :UserAccount
                   (entity {:UserAccount/Estimate
                            {:Balance :Float
                             :Loan    :Float}})
                   (record {:UserAccount/Total {:Total :Float}})
                   (event {:UserAccount/IncreaseLoan {:Balance :UserAccount/Total}}))
     (dataflow :UserAccount/IncreaseLoan
               {:UserAccount/Estimate {:Balance :UserAccount/IncreaseLoan.Total
                                       :Loan    '(+ :Balance 10000)}})
     (let [r (cn/make-instance :UserAccount/Total {:Total 100000})
           evt (cn/make-instance :UserAccount/IncreaseLoan {:Balance r})]
       (is (thrown-with-msg? Exception #"Error in: Event "
                             (cn/instance-of? :UserAccount/Estimate
                                              (first (tu/fresult (e/eval-all-dataflows evt)))))))))

#?(:clj
   (deftest access-wrong-event-entity
     (defcomponent :UserAccount
                   (entity {:UserAccount/Estimate
                            {:Balance :Float
                             :Loan    :Float}})
                   (record {:UserAccount/Total {:Total :Float}})
                   (event {:UserAccount/IncreaseLoan {:Balance :UserAccount/Total}}))
     (dataflow :UserAccount/IncreaseLoan
               ;Intentional
               {:UserAccount/Estimate {:Balance :UserAccount/Increase.Balance.Total
                                       :Loan    '(+ :Balance 10000)}})
     (let [r (cn/make-instance :UserAccount/Total {:Total 100000})
           evt (cn/make-instance :UserAccount/IncreaseLoan {:Balance r})]
       (is (thrown-with-msg? Exception #"Reference cannot be found for"
                             (cn/instance-of? :UserAccount/Estimate
                                              (first (tu/fresult (e/eval-all-dataflows evt)))))))))

#?(:clj
   (deftest ref-id-of-record
          (defcomponent :UserAccount
                        (record {:UserAccount/Estimate
                                 {:Balance :Float
                                  :Loan    :Float}})
                        (record {:UserAccount/Total {:Total :Float}})
            (event {:UserAccount/IncreaseLoan {cn/id-attr
                                               {:type :UUID
                                                :default "167d0b04-fa75-11eb-9a03-0242ac130003"}
                                               :Balance :UserAccount/Total}}))
          (dataflow :UserAccount/IncreaseLoan
                    {:UserAccount/Estimate {tu/q-id-attr (tu/append-id :UserAccount/IncreaseLoan)}}
                    {:UserAccount/Estimate {:Balance :UserAccount/IncreaseLoan.Balance.Total
                                            :Loan    '(+ :Balance 10000)}})
     (let [r (cn/make-instance :UserAccount/Total {:Total 100000})
                evt (cn/make-instance :UserAccount/IncreaseLoan {:Balance r})]
            (is (thrown? Exception (cn/instance-of? :UserAccount/Estimate (first (tu/fresult (e/eval-all-dataflows evt)))))))))

(deftest try_
  (defcomponent :Try
    (entity
     :Try/E
     {:X {:type :Int
          :indexed true}})
    (record
     :Try/R
     {:Y :Boolean})
    (dataflow
     :Try/Find
     [:try
      {:Try/E {:X? :Try/Find.X}}
      :ok {:Try/R {:Y true}}
      [:error :not-found] {:Try/R {:Y false}}]))
  (let [r1 (tu/first-result {:Try/Find {:X 100}})
        e (cn/make-instance {:Try/E {:X 100}})
        _ (tu/first-result {:Try/Create_E
                            {:Instance e}})
        r2 (tu/first-result {:Try/Find {:X 100}})]
    (is (not (:Y r1)))
    (is (:Y r2))))

(deftest password-match
  (defcomponent :PM
    (entity
     :PM/User
     {:UserName {:type :String
                 :indexed true}
      :Password :Password})
    (event
     :PM/UserLogin
     {:UserName :String
      :Password :Password})
    (dataflow
     :PM/UserLogin
     {:PM/User
      {:UserName? :PM/UserLogin.UserName}}
     [:match :PM/UserLogin.Password
      :PM/User.Password :PM/User]))
  (let [u (tu/first-result
           {:PM/Create_User
            {:Instance
             {:PM/User
              {:UserName "admin"
               :Password "admin"}}}})
        r1 (e/eval-all-dataflows
            {:PM/UserLogin
             {:UserName "admin"
              :Password "admin"}})
        r2 (e/eval-all-dataflows
            {:PM/UserLogin
             {:UserName "admin"
              :Password "kkkk"}})]
    (is (cn/same-instance? u (:result (first r1))))
    (is (not (:result (first r2))))))

#?(:clj
   (deftest data-generation-and-validation-for-listof []
    (testing "list-of"
      (testing "string"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :String}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (mapv :RefCheck/E3.AIdId data)))
          (is (every? #(every? string? %) (map :RefCheck/E3.AIdId data)))
          (is (every? uuid? (mapv (tu/append-id :RefCheck/E3) data)))))

      (testing "unique string"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :String}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (mapv :RefCheck/E3.AIdId data)))
          (is (every? #(every? string? %) (map :RefCheck/E3.AIdId data)))
          (is (every? uuid? (mapv (tu/append-id :RefCheck/E3) data)))))

      (testing "int"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Int}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? int? %) (map :RefCheck/E3.AIdId data)))))

      (testing "keyword"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Keyword}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? keyword? %) (map :RefCheck/E3.AIdId data)))))

      (testing "path"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Path}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? (fn [val]
                        (every? #(or (keyword? %) (string? %)) val))
                      (map :RefCheck/E3.AIdId data)))))

      (testing "float"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Float}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? float? %) (map :RefCheck/E3.AIdId data)))))

      (testing "double"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Double}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? double? %) (map :RefCheck/E3.AIdId data)))))

      (testing "decimal"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Decimal}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? decimal? %) (map :RefCheck/E3.AIdId data)))))

      (testing "boolean"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Boolean}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? boolean? %) (map :RefCheck/E3.AIdId data)))))

      (testing "any"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Any}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? any? %) (map :RefCheck/E3.AIdId data)))))

      (testing "map"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Map}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? #(every? map? %) (map :RefCheck/E3.AIdId data)))))

      (testing "date"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Date}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? (fn [val]
                        (every? #(instance? java.time.LocalDate %) val))
                      (map :RefCheck/E3.AIdId data)))))

      (testing "date-time"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :DateTime}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? (fn [val]
                        (every? #(instance? java.time.LocalDateTime %) val))
                      (map :RefCheck/E3.AIdId data)))))

      (testing "time"
        (defcomponent :RefCheck
                      (entity {:RefCheck/E3 {:AIdId {:listof :Time}}}))

        (let [data (tu/generate-data :RefCheck/E3)]
          (is (seq? data))
          (is (every? coll? (map :RefCheck/E3.AIdId data)))
          (is (every? (fn [val]
                        (every? #(instance? java.time.LocalTime %) val))
                      (map :RefCheck/E3.AIdId data))))))))

#?(:clj
   (deftest data-generation-and-validation-for-fractl-types []
      (testing "fractl type"
        (testing "entity"
          (defcomponent :Df01
                        (entity {:Df01/E
                                 {:X :Int
                                  :Y :Int}}))

          (let [data (tu/generate-data :Df01/E)]
            (is (seq? data))
            (is (every? #(int? (:Df01/E.X %)) data))
            (is (every? #(int? (:Df01/E.Y %)) data))
            (is (every? #(uuid? ((tu/append-id :Df01/E) %)) data))))

        (testing "record"
          (defcomponent :Df01
                        (record {:Df01/E
                                 {:X :Int
                                  :Y :Int}}))

          (let [data (tu/generate-data :Df01/E)]
            (is (seq? data))
            (is (every? #(int? (:Df01/E.X %)) data))
            (is (every? #(int? (:Df01/E.Y %)) data))
            (is (every? #(nil? ((tu/append-id :Df01/E) %)) data))))

        (testing "Reference to an entity's attribute"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E1 {:A :Int}})
                        (entity {:RefCheck/E2 {:AId {:ref (tu/append-id :RefCheck/E1)}
                                               :X :Int}})
                        (entity {:RefCheck/E3 {:AIdId {:ref :RefCheck/E2.AId}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(uuid? (:RefCheck/E3.AIdId %)) data))))

        (testing "Reference to an entity"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E1 {:A :Int}})
                        (entity {:RefCheck/E2 {:AId {:ref (tu/append-id :RefCheck/E1)}
                                               :X :Int}})
                        (entity {:RefCheck/E3 {:AIdId {:type :RefCheck/E1}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(instance? clojure.lang.PersistentArrayMap (:RefCheck/E3.AIdId %)) data))))

        (testing "Reference to a record"
          (defcomponent :RefCheck
                        (record {:RefCheck/E1 {:A :Int}})
                        (entity {:RefCheck/E2 {:AId {:ref :RefCheck/E1.A}
                                               :X :Int}})
                        (entity {:RefCheck/E3 {:AIdId {:type :RefCheck/E1}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(instance? clojure.lang.PersistentArrayMap (:RefCheck/E3.AIdId %)) data))))

        (testing "oneof"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:oneof ["diesel", "petrol", "cng"]}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(string? (:RefCheck/E3.AIdId %)) data))))

        (testing "string without format"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :String}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(string? (:RefCheck/E3.AIdId %)) data))))

        (testing "keyword"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Keyword}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(keyword? (:RefCheck/E3.AIdId %)) data))))

        (testing "path"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Path}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(or (keyword? %) (string? %)) (map :RefCheck/E3.AIdId data)))))

        (testing "int64"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Int64}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(int? (:RefCheck/E3.AIdId %)) data))))

        (testing "bigInteger"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :BigInteger}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(integer? (:RefCheck/E3.AIdId %)) data))))

        (testing "float"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Float}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(float? (:RefCheck/E3.AIdId %)) data))))

        (testing "double"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Double}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(double? (:RefCheck/E3.AIdId %)) data))))

        (testing "decimal"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Decimal}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(decimal? (:RefCheck/E3.AIdId %)) data))))

        (testing "boolean"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Boolean}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(boolean? (:RefCheck/E3.AIdId %)) data))))

        (testing "date"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Date}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(instance? java.time.LocalDate %) (map :RefCheck/E3.AIdId data)))))

        (testing "dateTime"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :DateTime}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(instance? java.time.LocalDateTime %) (map :RefCheck/E3.AIdId data)))))

        (testing "time"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Time}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(instance? java.time.LocalTime %) (map :RefCheck/E3.AIdId data)))))

        (testing "any"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Any}}}))

          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(any? (:RefCheck/E3.AIdId %)) data))))

        (testing "map"
          (defcomponent :RefCheck
                        (entity {:RefCheck/E3 {:AIdId {:type :Map}}}))
          (let [data (tu/generate-data :RefCheck/E3)]
            (is (seq? data))
            (is (every? #(map? (:RefCheck/E3.AIdId %)) data)))))))

(deftest components-in-model
  (component :Abc.X)
  (component :Abc.Y)
  (component :Bcd.Z)
  (is (= #{:Abc.X :Abc.Y} (set (cn/component-names :Abc))))
  (is (= #{:Bcd.Z} (set (cn/component-names :Bcd)))))

(deftest attribute-meta
  (defcomponent :AMeta
    (attribute
     :AMeta/Name
     {:type :String
      :meta {:instance {:ui {:Fractl.Fx/Input {}}}}}))
  (is (= {:unique false, :immutable false, :type :Fractl.Kernel.Lang/String}
         (cn/find-attribute-schema :AMeta/Name)))
  (is (= {:instance {:ui #:Fractl.Fx{:Input {}}}}
         (cn/fetch-meta :AMeta/Name))))

(deftest model-spec
  (let [spec {:name :crm :version "1.0.2"
              :fractl-version "current"
              :components [:Crm.Core :Crm.Sales]}]
    (ln/model spec)
    (is (= spec (ln/fetch-model :crm)))
    (is (= "1.0.2" (ln/model-version :crm)))))

#?(:clj
   (deftest multi-threaded-transactions
     (defcomponent :Mtt01
       (entity
        :Mtt01/E
        {:Id {:type :Int tu/guid true}
         :X :Int
         :Y :String}))
     (let [create-e (fn [id]
                      (let [x (* id 10)]
                        (tu/first-result
                         {:Mtt01/Create_E
                          {:Instance
                           {:Mtt01/E {:Id id :X x
                                      :Y (str id ", " x)}}}})))
           e? (partial cn/instance-of? :Mtt01/E)
           create-es #(mapv create-e %)
           lookup-all (fn [] (tu/result
                              {:Mtt01/LookupAll_E {}}))
           delete-e (fn [id]
                      (tu/first-result
                       {:Mtt01/Delete_E
                        {:Id id}}))
           delete-es #(mapv delete-e %)
           trtest (fn [opr ids]
                    (let [res (atom nil)
                          ^Thread t (Thread. #(reset! res (opr ids)))]
                      (.start t)
                      [t res]))
           chk (fn [[^Thread t res] ids]
                 (.join t)
                 (is (= (count ids) (count @res)))
                 (let [rs (filter e? @res)]
                   (is (> (count rs)
                          (int (* (count ids) 0.98))))))
           crtest (partial trtest create-es)
           deltest (partial trtest delete-es)]
       (let [ids1 (range 1 500)
             ids2 (range 500 1000)
             ids3 (range 20 100)
             ids4 (range 470 600)
             t1 (crtest ids1)
             t2 (crtest ids2)]
         (chk t1 ids1)
         (chk t2 ids2)
         (let [es (lookup-all)]
           (is (every? e? es)))
         (let [t3 (deltest ids3)
               t4 (deltest ids4)]
           (chk t3 ids3)
           (chk t4 ids4)
           (let [es (lookup-all)]
             (is (every? e? es))))))))
