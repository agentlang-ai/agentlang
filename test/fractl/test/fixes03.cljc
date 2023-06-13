(ns fractl.test.fixes03
  (:require #?(:clj [clojure.test :refer [deftest is]]
               :cljs [cljs.test :refer-macros [deftest is]])
            [fractl.component :as cn]
            [fractl.resolver.core :as r]
            [fractl.resolver.registry :as rg]
            [fractl.util.hash :as sh]
            [fractl.lang.syntax :as ls]
            [fractl.lang.datetime :as dt]
            [fractl.lang
             :refer [component attribute event
                     entity record relationship dataflow]]
            #?(:clj [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])))

(deftest issue-576-alias
  (defcomponent :I576
    (entity
     {:I576/E
      {:X :Int}})
    (record
     {:I576/R
      {:A {:listof :I576/E}
       :B :Int
       :C {:listof :I576/E}}})
    (dataflow
     :I576/Evt
     {:I576/E? {} :as [:Result
                       [:E1 :_ :_ :E4 :& :Es]]}
     {:I576/R
      {:A :Result
       :B '(+ :E1.X :E4.X)
       :C :Es}}))
  (let [xs (range 1 11)
        sum (apply + xs)
        rs1 (mapv #(tu/first-result
                    {:I576/Create_E
                     {:Instance
                      {:I576/E
                       {:X %}}}})
                  xs)
        r (tu/first-result {:I576/Evt {}})
        e? (partial cn/instance-of? :I576/E)]
    (is (every? e? rs1))
    (is (= sum (apply + (mapv :X rs1))))
    (is (cn/instance-of? :I576/R r))
    (is (every? e? (:A r)))
    (is (= sum (apply + (mapv :X (:A r)))))
    (is (= 5 (:B r)))
    (is (every? e? (:C r)))
    (is (= 6 (count (:C r))))))

(deftest issue-585-eval
  (defcomponent :I585
    (entity
     :I585/E
     {:K {:type :String
          :indexed true}
      :X :Int})
    (record
     :I585/R
     {:Y :Int})
    (defn i585-f1 [e]
      (cn/make-instance
       :I585/R
       {:Y (* (:X e) 200)}))
    (defn i585-f2 [e]
      [(cn/make-instance
        :I585/R
        {:Y (* (:X e) 10)})])
    (defn i585-seq-of-r? [xs]
      (every? (partial cn/instance-of? :I585/R) xs))
    (dataflow
     :I585/Evt1
     {:I585/E {:K? :I585/Evt1.K}}
     [:eval '(fractl.test.fixes03/i585-f1 :I585/E)
      :check :I585/R :as :Result]
     {:I585/E {:K "result" :X :Result.Y}})
    (dataflow
     :I585/Evt2
     {:I585/E {:K? :I585/Evt2.K}}
     [:eval '(fractl.test.fixes03/i585-f2 :I585/E)
      :check fractl.test.fixes03/i585-seq-of-r? :as [:R1]]
     {:I585/E {:K "result" :X :R1.Y}})
    (dataflow
     :I585/Evt3
     {:I585/E {:K? :I585/Evt3.K}}
     [:eval '(fractl.test.fixes03/i585-f1 :I585/E)]))
  (let [e1 (tu/first-result
            {:I585/Create_E
             {:Instance
              {:I585/E {:K "abc" :X 10}}}})
        r1 (tu/first-result
            {:I585/Evt1 {:K "abc"}})
        r2 (tu/first-result
            {:I585/Evt2 {:K "abc"}})
        r3 (tu/fresult
            (tu/eval-all-dataflows
             {:I585/Evt3 {:K "abc"}}))]
    (is (cn/instance-of? :I585/E r1))
    (is (= 2000 (:X r1)))
    (is (cn/instance-of? :I585/E r2))
    (is (= 100 (:X r2)))
    (is (cn/instance-of? :I585/R r3))
    (is (= 2000 (:Y r3)))))

(deftest issue-599-uq-error
  (defcomponent :I599
    (entity
     :I599/E
     {:N {:type :Int :indexed true}
      :X :Int})
    (record
     :I599/R
     {:Data :Map})
    (dataflow
     :I599/Evt
     {:I599/E {:N? 1} :as [:A :& :_]}
     {:I599/R
      {:Data
       [:q#
        {:custom-value 1234
         :resolvers
         [{:name :abc
           :config {:x [:uq# :A.X] :y 20}}]}]}}))
  (let [e (tu/first-result
           {:I599/Create_E
            {:Instance
             {:I599/E {:N 1 :X 10}}}})
        r (tu/first-result
           {:I599/Evt {}})]
    (is (cn/instance-of? :I599/R r))
    (let [{x :x y :y} (:config (first (get-in r [:Data :resolvers])))]
      (is (and (= 10 x) (= 20 y))))))

(deftest issue-621-ref-as-hex
  (defcomponent :I621
    (entity
     :I621/Model
     {:Name {:type :Path
             :unique true}
      :Version :String
      :Config {:type :Map
               :optional true}
      :ClojureImports {:listof :Any
                       :optional true}})
    (entity
     :I621/Component
     {:Name :Path
      :Model {:ref :I621/Model.Name}
      :ClojureImports {:listof :Any
                       :optional true}
      :meta {:unique [:Model :Name]}})

    (entity
     :I621/Rec
     {:Name :Path
      :Model {:ref :I621/Model.Name}
      :Component :Path
      :Attributes :Map
      :meta {:unique [:Model :Component :Name]}
      :Meta {:type :Map
             :optional true}})

    (event
     :I621/CreateRec
     {:Name :Path
      :Model :Path
      :Component :Path
      :Attributes :Map
      :Meta {:type :Map
             :optional true}})

    (dataflow
     :I621/CreateRec
     {:I621/Component {:Name? :I621/CreateRec.Component
                       :Model? :I621/CreateRec.Model} :as :C}
     {:I621/Rec {:Name :I621/CreateRec.Name
                 :Model :C.Model
                 :Component :C.Name
                 :Attributes :I621/CreateRec.Attributes
                 :Meta :I621/CreateRec.Meta}}))

  (let [m (tu/first-result
           {:I621/Create_Model
            {:Instance
             {:I621/Model
              {:Name :m :Version "1.0"}}}})
        c (tu/first-result
           {:I621/Create_Component
            {:Instance
             {:I621/Component
              {:Name :c :Model :m}}}})
        attrs {:a 1 :b false :c 3}
        r (tu/first-result
           {:I621/CreateRec
            {:Name :r1
             :Model :m
             :Component :c
             :Attributes attrs}})
        m1 (tu/first-result
            {:I621/Lookup_Model
             {cn/id-attr (cn/id-attr m)}})
        c1 (tu/first-result
            {:I621/Lookup_Component
             {cn/id-attr (cn/id-attr c)}})
        r1 (tu/first-result
            {:I621/Lookup_Rec
             {cn/id-attr (cn/id-attr r)}})]
    (defn same-instance? [a b ks]
      (every? #(= (% a) (% b)) ks))
    (is (same-instance? m m1 [cn/id-attr :Name :Version]))
    (is (same-instance? c c1 [cn/id-attr :Name :Model]))
    (is (same-instance? r r1 [cn/id-attr :Name :Model :Component]))
    (is (= (:Model r1) :m))
    (is (= (:Component r1) :c))
    (is (= (:Attributes r1) attrs))))

(deftest issue-669-keyword-query-bug
  (defcomponent :I669
    (entity
     :I669/E
     {:K :Keyword
      :P :Path}))
  (let [e (tu/first-result
           {:I669/Create_E
            {:Instance
             {:I669/E
              {:K :hello
               :P :I669/F}}}})
        e1 (tu/first-result
            {:I669/Lookup_E
             {cn/id-attr (cn/id-attr e)}})]
    (is (cn/same-instance? e e1))))

(defn first-result [rs]
  (mapv first rs))

(deftest issue-686-list-of-path
  (defcomponent :I686
    (entity
     :I686/E
     {:Name {:type :Path
             :unique true}})
    (event
     :I686/GetEs
     {:Names {:listof :Path}})
    (record :I686/Result {:Es {:listof :I686/E}})
    (dataflow
     :I686/GetEs
     [:for-each :I686/GetEs.Names
      {:I686/E {:Name? :%}}
      :as :Es]
     {:I686/Result {:Es '(fractl.test.fixes03/first-result :Es)}}))
  (let [names [:A :B :C]
        es01 (mapv
              #(tu/first-result
                {:I686/Create_E
                 {:Instance
                  {:I686/E
                   {:Name %}}}})
              names)]
    (is (every? (partial cn/instance-of? :I686/E) es01))
    (let [rs (:Es
              (tu/first-result
               {:I686/GetEs
                {:Names [:A :C]}}))]
      (is (every? (partial cn/instance-of? :I686/E) rs))
      (is (= 2 (count rs)))
      (is (every? identity (mapv (fn [n] (some #{n} #{:A :C})) (mapv :Name rs)))))))

(deftest issue-741-rel-delete
  (defcomponent :I741
    (entity
     :I741/E1
     {:X {:type :Int
          :identity true}
      :Y :Int})
    (entity
     :I741/E2
     {:A {:type :Int
          :identity true}
      :B :Int})
    (entity
     :I741/E3
     {:C {:type :Int
          :identity true}
      :D :Int})
    (relationship
     :I741/R1
     {:meta {:contains [:I741/E1 :I741/E2]
             :cascade-on-delete false}})
    (relationship
     :I741/R2
     {:meta {:contains [:I741/E2 :I741/E3]
             :cascade-on-delete false}})
    (dataflow
     :I741/CreateE2
     {:I741/E1 {:X? :I741/CreateE2.E1} :as :E1}
     {:I741/E2
      {:A 10 :B 20}
      :-> [{:I741/R1 {}} :E1]})
    (dataflow
     :I741/CreateE3
     {:I741/E2
      {:A? :I741/CreateE3.E2}
      :-> [:I741/R1? {:I741/E1 {:X? :I741/CreateE3.E1}}]
      :as :E2}
     {:I741/E3
      {:C 3 :D 5}
      :-> [{:I741/R2 {}} :E2]})
    (dataflow
     :I741/LookupE2
     {:I741/E2? {}
      :-> [:I741/R1?
           {:I741/E1 {:X? :I741/LookupE2.E1}}]})
    (dataflow
     :I741/RemoveR2
     [:delete :I741/R2 [:->
                        {:I741/E2 {:A? :I741/RemoveR2.E2}}
                        {:I741/E3 {:C? :I741/RemoveR2.E3}}]])
    (dataflow
     :I741/RemoveR1
     [:delete :I741/R1 [:->
                        {:I741/E1 {:X? :I741/RemoveR1.E1}}
                        {:I741/E2 {:A? :I741/RemoveR1.E2}}]]))
  (let [e1 (tu/first-result
            {:I741/Create_E1
             {:Instance
              {:I741/E1 {:X 1 :Y 10}}}})
        e2 (tu/result
            {:I741/CreateE2
             {:E1 1}})]
    (is (cn/instance-of? :I741/E1 e1))
    (is (cn/instance-of? :I741/E2 e2))
    (is (cn/instance-of? :I741/R1 (first (:-> e2))))
    (defn- lookup-e2 [exists]
      (let [r (tu/result
               {:I741/LookupE2
                {:E1 1}})]
        (if exists
          (is (and (cn/instance-of? :I741/E2 (first r))
                   (= 20 (:B (first r)))))
          (is (= [:I741 :E2] r)))))
    (lookup-e2 true)
    (is (cn/instance-of?
         :I741/E3
         (tu/result
          {:I741/CreateE3
           {:E1 1 :E2 10}})))
    (is (not (tu/first-result
              {:I741/RemoveR1
               {:E1 1 :E2 10}})))
    (is (cn/instance-of?
         :I741/R2
         (tu/first-result
          {:I741/RemoveR2
           {:E2 10 :E3 3}})))
    (lookup-e2 true)
    (let [d1 (tu/first-result
              {:I741/RemoveR1
               {:E1 1 :E2 10}})]
      (is (cn/instance-of? :I741/R1 d1))
      (lookup-e2 false))))

(deftest issue-741-rel-delete-between
  (defcomponent :I741B
    (entity
     :I741B/E1
     {:X {:type :Int
          :identity true}
      :Y :Int})
    (entity
     :I741B/E2
     {:A {:type :Int
          :identity true}
      :B :Int})
    (relationship
     :I741B/R1
     {:meta {:between [:I741B/E1 :I741B/E2]}})
    (dataflow
     :I741B/CreateE2
     {:I741B/E1 {:X? :I741B/CreateE2.E1} :as :E1}
     {:I741B/E2
      {:A 10 :B 20}
      :-> [{:I741B/R1 {}} :E1]})
    (dataflow
     :I741B/LookupE2
     {:I741B/E2? {}
      :-> [:I741B/R1?
           {:I741B/E1 {:X? :I741B/LookupE2.E1}}]})
    (dataflow
     :I741B/RemoveR1
     [:delete :I741B/R1 [:->
                        {:I741B/E1 {:X? :I741B/RemoveR1.E1}}
                        {:I741B/E2 {:A? :I741B/RemoveR1.E2}}]]))
  (let [e1 (tu/first-result
            {:I741B/Create_E1
             {:Instance
              {:I741B/E1 {:X 1 :Y 10}}}})
        e2 (tu/result
            {:I741B/CreateE2
             {:E1 1}})]
    (is (cn/instance-of? :I741B/E1 e1))
    (is (cn/instance-of? :I741B/E2 e2))
    (is (cn/instance-of? :I741B/R1 (first (:-> e2))))
    (defn- lookup-e2 [exists]
      (let [r (if exists
                (tu/result
                 {:I741B/LookupE2
                  {:E1 1}})
                (tu/result
                 {:I741B/Lookup_E2
                  {:A 10}}))]
        (is (and (cn/instance-of? :I741B/E2 (first r))
                 (= 20 (:B (first r)))))))
    (lookup-e2 true)
    (let [d1 (tu/first-result
              {:I741B/RemoveR1
               {:E1 1 :E2 10}})]
      (is (cn/instance-of? :I741B/R1 d1))
      (lookup-e2 false))))

(deftest issue-754-for-each-introspect
  (let [s1 (ls/introspect
            [:for-each :E1
             {:FeDel/E2 {:A? :%.X}}
             [:delete :FeDel/E1 {:X :%.X}]
             :as :P])
        s2 (ls/introspect
            [:for-each :collection
             {:Department {:Name "hamza"}}
             [:delete :Department {:Name "hamza"}] :as :p])]
    (is (and (ls/for-each? s1) (ls/for-each? s2)))
    (is (= :E1 (ls/name-tag (ls/value-tag s1))))
    (is (= :collection (ls/name-tag (ls/value-tag s2))))
    (is (= :P (ls/alias-tag s1)))
    (is (= :p (ls/alias-tag s2)))
    (is (= 2 (count (ls/body-tag s1))))
    (is (= 2 (count (ls/body-tag s2))))))

(deftest issue-761-relationship-syntax
  (let [pat1 {:Acme/Employee
              {:Name "xyz"}
              :-> [{:Acme/WorksFor {:Location "south"}} :Dept]}
        obj1 (ls/introspect pat1)
        pat2 {:Acme/Employee? {}
              :-> [:Acme/WorksFor? :Dept]}
        obj2 (ls/introspect pat2)
        pat3 {:Acme/Employee? {}
              :-> [:Acme/WorksFor?
                   {:Acme/Dept {:No :DeptNo}
                    :-> [:Acme/PartOf? {:Acme/Company {:Name :CompanyName}}]}]}
        obj3 (ls/introspect pat3)
        pat4 {:C/E {:X 100}
              :-> [[{:C/R1 {}} :A]
                   [{:C/R2 {}} :B]]}
        obj4 (ls/introspect pat4)]
    (is (and (ls/upsert? obj1) (ls/relationship-object obj1)))
    (is (and (ls/query-upsert? obj2) (ls/relationship-object obj2)))
    (is (and (ls/query-upsert? obj3) (ls/relationship-object obj3)))
    (is (and (ls/upsert? obj4) (ls/relationship-object obj4)))
    (is (= (ls/raw obj1) pat1))
    (is (= (ls/raw obj2) pat2))
    (is (= (ls/raw obj3) pat3))
    (is (= (ls/raw obj4) pat4))
    (let [u1 (ls/upsert {ls/record-tag :Person
                         ls/attrs-tag {:Age :Int :Name :String}
                         ls/alias-tag :P1
                         ls/rel-tag [{:Spouse {}} :P2]})
          qu1 (ls/query-upsert {ls/record-tag :Person
                                ls/attrs-tag {:Name? "abc" :Age 100}
                                ls/alias-tag :P1
                                ls/rel-tag [:Spouse? {:Person {:Name? "xyz"}}]})
          d1 (ls/delete {ls/record-tag :Spouse
                         ls/rel-tag [{:Person {:Name "xyz"}} {:Person{:Name "abc"}}]})]
      (is (ls/upsert? u1))
      (is (ls/query-upsert? qu1))
      (is (= (ls/raw-relationship (ls/rel-tag u1)) [{:Spouse {}} :P2]))
      (is (= (ls/raw-relationship (ls/rel-tag qu1)) [:Spouse? {:Person {:Name? "xyz"}}]))
      (is (= (ls/raw-relationship (ls/rel-tag d1)) [{:Person {:Name "xyz"}} {:Person{:Name "abc"}}])))))

(deftest issue-765-delete-in-match
  (defcomponent :I765
    (entity
     :I765/E1
     {:X {:type :Int :identity true}})
    (entity
     :I765/E2
     {:Y {:type :Int :identity true}})
    (dataflow
     :I765/DelE
     [:match :I765/DelE.V
      1 [:delete :I765/E1 {:X :I765/DelE.X}]
      2 [:delete :I765/E2 {:Y :I765/DelE.Y}]]))
  (let [e1 (tu/first-result
            {:I765/Create_E1
             {:Instance
              {:I765/E1 {:X 100}}}})
        e2 (tu/first-result
            {:I765/Create_E2
             {:Instance
              {:I765/E2 {:Y 200}}}})
        r1 (tu/first-result
            {:I765/DelE {:V 1 :X 100}})
        r2 (tu/first-result
            {:I765/DelE {:V 2 :Y 200}})]
    (is (cn/same-instance? e1 r1))
    (is (cn/same-instance? e2 r2))))

(deftest issue-775-syntax-api-delete-bug
  (let [pat [:delete :CommentOnPost
             [:->
              {:Post {:Id :DeleteComment.PostId}}
              {:Comment {:Id :DeleteComment.CommentId}}]]]
    (is (= pat (ls/raw (ls/introspect pat))))))

(deftest syntax-api-alias-bug
  (let [pat {:User {:Email? :CreatePost.UserEmail}, :as :U}
        ir (ls/introspect pat)]
    (is (= (ls/alias-tag ir) :U))
    (is (= pat (ls/raw ir)))))

(deftest redefine-core-types
  (defcomponent :RedefTypes
    (attribute
     :RedefTypes/DateTime
     {:type :String})
    (entity
     :RedefTypes/E
     {:A :RedefTypes/DateTime
      :B :DateTime}))
  (is (tu/is-error
       #(cn/make-instance
         {:RedefTypes/E
          {:A "abc"
           :B "xyz"}})))
  (let [e1 (cn/make-instance
            {:RedefTypes/E
             {:A "abc"
              :B (dt/now)}})]
    (is (cn/instance-of? :RedefTypes/E e1))))

(deftest query-object-bug
  (let [obj (ls/query-object {ls/record-tag :Blog/PostAuthorship?})]
    (is (= (ls/raw obj) :Blog/PostAuthorship?))))

(deftest path-query-syntax
  (let [p1 {:C/E? "path://A/Evt.A/R/B"}
        r1 (ls/introspect p1)
        p2 {:C/E {:? "path://A/Evt.A/R/B"
                  :K 100}}
        r2 (ls/introspect p2)]
    (is (ls/query-upsert? r1))
    (is (ls/query-upsert? r2))
    (is (= p1 (ls/raw r1)))
    (is (= p2 (ls/raw r2)))))

(deftest reference-syntax
  (let [p1 :X
        r1 (ls/introspect p1)
        p2 :Abc/Xyz
        r2 (ls/introspect p2)]
    (is (ls/reference? r1))
    (is (ls/reference? r2))
    (is (= p1 (ls/raw r1)))
    (is (= p2 (ls/raw r2)))))

(deftest eval-syntax-bug
  (let [fn-call '(a/f :A/K.Arg1 :A/K.Arg2)
        exp [:eval fn-call]
        p1 (ls/introspect exp)
        exp-with-check (vec (concat exp [:check :A/B]))
        p2 (ls/introspect exp-with-check)
        p3 (ls/introspect (vec (concat exp [:as :R])))
        p4 (ls/introspect (vec (concat exp-with-check [:as :R])))
        ps [p1 p2 p3 p4]]
    (is (every? ls/eval? ps))
    (is (every? #(= fn-call (second (ls/raw (ls/exp-tag %)))) ps))
    (is (= :A/B (ls/raw (ls/check-tag p2))))
    (is (= :R (ls/raw (ls/alias-tag p3))))
    (is (and (= :A/B (ls/raw (ls/check-tag p4)))
             (= :R (ls/raw (ls/alias-tag p4)))))))

(deftest issue-849
  (defcomponent :I849
    (entity
     :I849/E
     {:X {:type :Int :default 1000}})
    (entity
     :I849/F
     {:Y :Int})
    (record
     :I849/Rec
     {:A :String
      :B {:type :Int
          :unique true
          :check pos?
          :label 'pos?}})
    (event
     :I849/Evt
     {:E :I849/E})
    (relationship
     :I849/Rel
     {:meta {:contains [:I849/E :I849/F]}
      :G :Int
      :H '(+ 1 :G)}))
  (defn- is-scm [n s]
    (is (= s (cn/fetch-user-schema n))))
  (is-scm
   :I849/E
   {:X {:type :Int, :default 1000}})
  (is-scm
   :I849/F
   {:Y :Int})
  (is-scm
   :I849/Rec
   {:A :String
    :B {:type :Int
        :unique true
        :check pos?
        :label 'pos?}})
  (is-scm
   :I849/Evt
   {:E :I849/E})
  (is-scm
   :I849/Rel
   {:meta {:contains [:I849/E :I849/F]}
    :G :Int
    :H '(+ 1 :G)}))

(deftest issue-855-rel-upsert-bug
  (defcomponent :I855
    (entity
     :I855/E1 {:X {:type :Int :identity true}})
    (entity
     :I855/E2 {:Y {:type :Int :identity true}})
    (relationship
     :I855/R {:meta {:contains [:I855/E1 :I855/E2]}})
    (dataflow
     :I855/Cr1
     {:I855/E2
      {:Y 100}
      :-> [{:I855/R {}}
           {:I855/E1 {:X? :I855/Cr1.E1}}]})
    (dataflow
     :I855/Cr2
     {:I855/E1 {:X? :I855/Cr2.E1} :as :E1}
     {:I855/E2
      {:Y 200}
      :-> [{:I855/R {}} :E1]}))
  (let [e1 (tu/first-result
            {:I855/Create_E1
             {:Instance
              {:I855/E1 {:X 1}}}})
        r11 (tu/result
             {:I855/Cr1 {:E1 1}})
        r21 (tu/result
             {:I855/Cr2 {:E1 1}})]
    (defn- chk [status evt]
      (let [s (:status (first (tu/eval-all-dataflows evt)))]
        (is (= s status))))
    (chk :not-found {:I855/Cr1 {:E1 2}})
    (chk :not-found {:I855/Cr2 {:E1 2}})
    (defn- check-r [e1 e2]
      (is (cn/instance-of? :I855/E2 e2))
      (let [r (first (ls/rel-tag e2))]
        (is (cn/instance-of? :I855/R r))
        (is (= (:X e1) (:E1 r)))))
    (is (cn/instance-of? :I855/E1 e1))
    (check-r e1 r11)
    (check-r e1 r21)))

(deftest issue-886-create-update
  (defcomponent :I886
    (entity
     :I886/E
     {:Id {:type :Int :identity true}
      :Name :String})
    (dataflow
     :I886/CreateE
     :I886/CreateE.Instance)
    (dataflow
     :I886/UpdateE
     {:I886/E
      {:Id? :I886/UpdateE.Id
       :Name :I886/UpdateE.Name}}))
  (let [e1 (tu/first-result
            {:I886/CreateE
             {:Instance
              {:I886/E
               {:Id 1 :Name "abc"}}}})
        e2 (tu/first-result
            {:I886/Lookup_E
             {:Id 1}})]
    (is (cn/same-instance? e1 e2))
    (let [e3 (tu/first-result
              {:I886/UpdateE
               {:Id 1 :Name "xyz"}})
          e4 (tu/first-result
              {:I886/Lookup_E
               {:Id 1}})]
      (is (cn/instance-eq? e1 e3))
      (is (= (:Name e3) "xyz"))
      (is (cn/instance-eq? e1 e4))
      (is (= (:Name e4) "xyz")))))

(deftest issue-906-cascade-delete-bug
  (defcomponent :I906
    (entity
     :I906/P
     {:X {:type :Int :identity true}})
    (entity
     :I906/C
     {:Y {:type :Int :identity true}})
    (entity
     :I906/D
     {:Z {:type :Int :identity true}})
    (entity
     :I906/E
     {:A {:type :Int :identity true}})
    (relationship
     :I906/R
     {:meta {:contains [:I906/P :I906/C]}})
    (relationship
     :I906/F
     {:meta {:contains [:I906/C :I906/D]}})
    (relationship
     :I906/G
     {:meta {:between [:I906/D :I906/E]}}))
  (def sort-by-y (partial tu/sort-by-attr :Y))
  (let [[p1 p2] (mapv
                 #(tu/first-result
                   {:I906/Create_P
                    {:Instance
                     {:I906/P {:X %}}}})
                 [1 2])
        p3 (tu/first-result
            {:I906/Create_P
             {:Instance
              {:I906/P {:X 3}}}})
        create-cs (fn [p]
                    (mapv
                     #(tu/result
                       {:I906/Create_C
                        {:Instance
                         {:I906/C {:Y %1}}
                         :P %2}})
                     [101 102] [p p]))
        [c11 c12] (create-cs 1)
        c21 (tu/result
             {:I906/Create_C
              {:Instance
               {:I906/C {:Y 201}}
               :P 2}})
        d1 (tu/result
            {:I906/Create_D
             {:P 1 :C 101 :Instance {:I906/D {:Z 301}}}})
        e1 (tu/first-result
            {:I906/Create_E
             {:Instance
              {:I906/E {:A 789}}}})
        g1 (tu/first-result
            {:I906/Create_G
             {:Instance
              {:I906/G
               {:D 301 :E 789}}}})]
    (is (cn/instance-of? :I906/E e1))
    (is (cn/instance-of? :I906/G g1))
    (is (cn/same-instance? g1 (tu/first-result {:I906/Lookup_G {:D 301 :E 789}})))
    (is (cn/same-instance? p3 (tu/first-result
                               {:I906/Lookup_P {:X 3}})))
    (is (cn/same-instance? p3 (tu/first-result
                               {:I906/Delete_P {:X 3}})))
    (is (tu/not-found? (tu/eval-all-dataflows {:I906/Lookup_P {:X 3}})))
    (is (cn/instance-of? :I906/D d1))
    (defn- lookup-d1 []
      (tu/eval-all-dataflows
       {:I906/Lookup_D
        {:P 1 :C 101 :Z 301}}))
    (is (cn/same-instance? (dissoc d1 :->) (first (:result (first (lookup-d1))))))
    (defn- lookupall-cs
      ([only-eval p]
       ((if only-eval tu/eval-all-dataflows tu/result)
        {:I906/LookupAll_C {:P p}}))
      ([p] (lookupall-cs false p)))
    (is (= (mapv #(dissoc % :->) [c11 c12])
           (sort-by-y (lookupall-cs 1))))
    (defn- check-c2s []
      (let [c2s (lookupall-cs 2)]
        (is (= (count c2s) 1))
        (is (every? #(cn/instance-of? :I906/C %) c2s))
        (is (= (dissoc c21 :->) (first c2s)))))
    (check-c2s)
    (is (cn/same-instance? p1 (tu/first-result {:I906/Delete_P {:X 1}})))
    (is (tu/not-found? (tu/eval-all-dataflows {:I906/Lookup_G {:D 301 :E 789}})))
    ;; Give time for the Delete_C event-firing to commit the db-transaction,
    ;; this has been a problem when the complete test-suite is running.
    (check-c2s)
    (is (tu/not-found? (lookupall-cs true 1)))
    (is (tu/not-found? (lookup-d1)))
    (defn- check-css [cs cnt ys]
      (is (= (count cs) cnt))
      (is (every? #(cn/instance-of? :I906/C %) cs))
      (is (mapv (fn [y] (some #{y} ys)) (mapv :Y cs))))
    (check-css (create-cs 2) 2 #{101 102})
    (check-css (lookupall-cs 2) 3 #{101 102 201})
    (is (cn/same-instance? c21 (tu/first-result {:I906/Delete_C {:P 2 :Y 201}})))
    (check-css (lookupall-cs 2) 2 #{101 102})))

(deftest issue-906-cascade-delete-with-non-identity
  (defcomponent :I906B
    (entity
     :I906B/P
     {:X {:type :Int :identity true}
      :A {:type :Int :indexed true}})
    (entity
     :I906B/C
     {:Y {:type :Int :identity true}
      :B {:type :Int :indexed true}})
    (entity
     :I906B/D
     {:Z {:type :Int :identity true}
      :K {:type :Int :indexed true}})
    (relationship
     :I906B/CD
     {:meta {:between [:I906B/C :I906B/D :on [:B :K]]}})
    (relationship
     :I906B/R
     {:meta {:contains [:I906B/P :I906B/C :on [:A :B]]}}))
  (let [[p1 p2 :as ps] (mapv
                 #(tu/first-result
                   {:I906B/Create_P
                    {:Instance
                     {:I906B/P {:X % :A (* 10 %)}}}})
                 [1 2])
        create-cs (fn [p]
                    (mapv
                     #(tu/result
                       {:I906B/Create_C
                        {:Instance
                         {:I906B/C {:Y %1 :B (* 10 %1)}}
                         :P %2}})
                     [101 102] [p p]))
        [c11 c12 :as cs] (create-cs 1)
        c21 (tu/result
             {:I906B/Create_C
              {:Instance
               {:I906B/C {:Y 201 :B 11}}
               :P 2}})
        p? (partial cn/instance-of? :I906B/P)
        c? (partial cn/instance-of? :I906B/C)
        d1 (tu/first-result
            {:I906B/Create_D
             {:Instance {:I906B/D {:Z 111 :K 9}}}})
        cd1 (tu/first-result
             {:I906B/Create_CD
              {:Instance
               {:I906B/CD
                {:CIdentity 201 :DIdentity 111 :C 11 :D 9}}}})]
    (is (cn/instance-of? :I906B/D d1))
    (is (cn/instance-of? :I906B/CD cd1))
    (defn- lookupall-cs
      ([only-eval p]
       ((if only-eval tu/eval-all-dataflows tu/result)
        {:I906B/LookupAll_C {:P p}}))
      ([p] (lookupall-cs false p)))
    (is (every? p? ps))
    (is (every? c? (conj cs c21)))
    (defn- check-cs [a n]
      (let [cs (lookupall-cs a)]
        (is (= n (count cs)))
        (is (every? c? cs))))
    (check-cs 10 2)
    (check-cs 20 1)
    (is (cn/same-instance? p1 (tu/first-result
                               {:I906B/Delete_P
                                {:X 1}})))
    (is (tu/not-found? (lookupall-cs true 10)))
    (check-cs 20 1)
    (is (cn/same-instance? cd1 (tu/first-result
                                {:I906B/Lookup_CD
                                 {:CIdentity 201 :DIdentity 111}})))
    (is (cn/same-instance? d1 (tu/first-result
                               {:I906B/Lookup_D {:Z 111}})))
    (is (cn/same-instance? p2 (tu/first-result
                               {:I906B/Delete_P
                                {:X 2}})))
    (is (tu/not-found? (lookupall-cs true 20)))
    (is (tu/not-found? (tu/eval-all-dataflows
                        {:I906B/Lookup_CD
                         {:CIdentity 201 :DIdentity 111}})))
    (is (cn/same-instance? d1 (tu/first-result
                               {:I906B/Lookup_D {:Z 111}})))))
