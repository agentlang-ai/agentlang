(ns fractl.test.features02
  (:require #?(:clj [clojure.test :refer [deftest is]]
               :cljs [cljs.test :refer-macros [deftest is]])
            [fractl.component :as cn]
            [fractl.lang
             :refer [component attribute event
                     entity record relationship
                     dataflow]]
            [fractl.lang.syntax :as ls]
            [fractl.lang.relgraph :as rg]
            [fractl.auth.model]
            [fractl.evaluator :as e]
            #?(:clj [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])))

(deftest issue-594-basic-relationships
  (defcomponent :I594B
    (entity
     :I594B/Dept
     {:No {:type :Int
           :identity true}
      :Name :String})
    (entity
     :I594B/Employee
     {:Name {:type :String
             :identity true}
      :Salary :Decimal})
    (relationship
     :I594B/WorksFor
     {:meta
      {:contains [:I594B/Dept :I594B/Employee]}
      :Location {:type :String :indexed true}})
    (dataflow
     :I594B/CreateEmployee
     {:I594B/Dept {:No? :I594B/CreateEmployee.Dept}
      :as [:D]}
     {:I594B/Employee
      {:Name :I594B/CreateEmployee.Name
       :Salary :I594B/CreateEmployee.Salary}
      :-> [{:I594B/WorksFor {:Location "ddd"}} :D]})
    (dataflow
     :I594B/FindEmployees
     {:I594B/Employee
      {:Salary? [:>= 1300M]}
      :-> [{:I594B/WorksFor {:Location? "ddd"}}
           {:I594B/Dept {:No? :I594B/FindEmployees.Dept}}]})
    (relationship
     :I594B/Spouse
     {:meta
      {:between [:I594B/Employee :I594B/Employee]}}))
  (let [rscm (cn/fetch-schema :I594B/WorksFor)
        r1 (:ref (cn/find-attribute-schema (:Dept rscm)))
        r2 (:ref (cn/find-attribute-schema (:Employee rscm)))
        rels #{:I594B/WorksFor}]
    (is (= rels (cn/find-relationships :I594B/Dept)))
    (is (= (conj rels :I594B/Spouse)
           (cn/find-relationships :I594B/Employee)))
    (is (and (= (:component r1) :I594B)
             (= (:record r1) :Dept)
             (= (first (:refs r1)) :No)))
    (is (and (= (:component r2) :I594B)
             (= (:record r2) :Employee)
             (= (first (:refs r2)) :Name))))
  (let [dept (tu/first-result
              {:I594B/Upsert_Dept
               {:Instance
                {:I594B/Dept
                 {:No 101 :Name "abc"}}}})
        r (tu/result
           {:I594B/CreateEmployee
            {:Name "xyz" :Salary 1300M :Dept 101}})]
    (is (cn/instance-of? :I594B/Dept dept))
    (is (cn/instance-of? :I594B/Employee r))
    (let [rel (first (ls/rel-tag r))]
      (is (cn/instance-of? :I594B/WorksFor rel))
      (is (= (:No dept) (:Dept rel)))
      (is (= (:Name r) (:Employee rel))))
    (let [emps (tu/result
                {:I594B/FindEmployees
                 {:Dept 101}})]
      (is (cn/same-instance? r (first emps))))))

(deftest issue-594-multi-level-relationships
  (defcomponent :I594ML
    (entity
     :I594ML/Company
     {:Name {:type :String
             :identity true}})
    (entity
     :I594ML/Dept
     {:Name {:type :String
             :identity true}
      :Location :String})
    (entity
     :I594ML/Employee
     {:Name {:type :String
             :identity true}
      :Salary :Decimal})
    (relationship
     :I594ML/PartOf
     {:meta
      {:contains [:I594ML/Company :I594ML/Dept]}})
    (relationship
     :I594ML/WorksFor
     {:meta
      {:contains [:I594ML/Dept :I594ML/Employee]}})
    (dataflow
     :I594ML/CreateDept
     {:I594ML/Company
      {:Name? :I594ML/CreateDept.Company}
      :as [:C]}
     {:I594ML/Dept
      {:Name :I594ML/CreateDept.Dept
       :Location :I594ML/CreateDept.Location}
      :-> [{:I594ML/PartOf {}} :C]})
    (dataflow
     :I594ML/CreateEmployee
     {:I594ML/Dept {:Name? :I594ML/CreateEmployee.Dept}
      :-> [:I594ML/PartOf?
           {:I594ML/Company {:Name? :I594ML/CreateEmployee.Company}}]
      :as [:D]}
     {:I594ML/Employee
      {:Name :I594ML/CreateEmployee.Emp
       :Salary :I594ML/CreateEmployee.Salary}
      :-> [{:I594ML/WorksFor {}} :D]})
    (dataflow
     :I594ML/LookupEmployees
     {:I594ML/Employee?
      {}
      :-> [:I594ML/WorksFor?
           {:I594ML/Dept {:Name? :I594ML/LookupEmployees.Dept}
            :-> [:I594ML/PartOf?
                 {:I594ML/Company {:Name? :I594ML/LookupEmployees.Company}}]}]}))
  (let [c (tu/first-result
           {:I594ML/Upsert_Company
            {:Instance
             {:I594ML/Company {:Name "acme"}}}})
        d (tu/result
           {:I594ML/CreateDept
            {:Company "acme"
             :Dept "101"
             :Location "west"}})
        e (tu/result
           {:I594ML/CreateEmployee
            {:Company "acme"
             :Dept "101"
             :Emp "steve"
             :Salary 5600}})
        r (tu/first-result
           {:I594ML/LookupEmployees
            {:Company "acme" :Dept "101"}})]
    (is (cn/instance-of? :I594ML/Company c))
    (is (cn/instance-of? :I594ML/Dept d))
    (let [rel (first (ls/rel-tag d))]
      (is (cn/instance-of? :I594ML/PartOf rel))
      (is (= "acme" (:Company rel)))
      (is (= "101" (:Dept rel))))
    (is (cn/instance-of? :I594ML/Employee e))
    (let [rel (first (ls/rel-tag e))]
      (is (cn/instance-of? :I594ML/WorksFor rel))
      (is (= "101" (:Dept rel)))
      (is (= "steve" (:Employee rel))))
    (is (cn/instance-of? :I594ML/Employee r))
    (is (cn/same-instance? e r))))

(deftest issue-594-multi-relationships
  (defcomponent :I594MR
    (entity
     :I594MR/A
     {:X {:type :Int
          :identity true}})
    (entity
     :I594MR/B
     {:Y {:type :Int
          :identity true}})
    (entity
     :I594MR/C
     {:Z {:type :Int
          :identity true}})
    (relationship
     :I594MR/R1
     {:meta
      {:between [:I594MR/B :I594MR/A]}})
    (relationship
     :I594MR/R2
     {:meta
      {:between [:I594MR/C :I594MR/A]}})
    (dataflow
     :I594MR/CreateA
     {:I594MR/A
      {:X :I594MR/CreateA.X}
      :-> [[{:I594MR/R1 {}} {:I594MR/B {:Y? :I594MR/CreateA.B}}]
           [{:I594MR/R2 {}} {:I594MR/C {:Z? :I594MR/CreateA.C}}]]})
    (dataflow
     :I594MR/FindA
     {:I594MR/A? {}
      :-> [[:I594MR/R1? {:I594MR/B {:Y? :I594MR/FindA.B}}]
           [:I594MR/R2? {:I594MR/C {:Z? :I594MR/FindA.C}}]]}))
  (let [b (tu/first-result
           {:I594MR/Upsert_B
            {:Instance
             {:I594MR/B {:Y 100}}}})
        c (tu/first-result
           {:I594MR/Upsert_C
            {:Instance
             {:I594MR/C {:Z 200}}}})
        a (tu/result
           {:I594MR/CreateA
            {:X 1 :B 100 :C 200}})
        r (tu/first-result
           {:I594MR/FindA
            {:B 100 :C 200}})]
    (is (cn/instance-of? :I594MR/B b))
    (is (cn/instance-of? :I594MR/C c))
    (is (cn/instance-of? :I594MR/A a))
    (is (= 2 (count (ls/rel-tag a))))
    (every? #(or (cn/instance-of? :I594MR/R1 %)
                 (cn/instance-of? :I594MR/R2 %))
            (ls/rel-tag a))
    (is (cn/same-instance? r a))))

(defn i649-test [n cascade-on-delete]
  (let [cn (keyword (str "I6490" n))
        p (partial tu/make-path cn)]
    (defcomponent cn
      (entity
       (p :E1)
       {:N {:type :String
            :identity true}
        :X {:type :Int :indexed true}})
      (entity
       (p :E2)
       {:Y {:type :Int :indexed true}})
      (relationship
       (p :R1)
       {:meta
        {:contains [(p :E1) (p :E2)
                    :on [:X :Y]
                    :cascade-on-delete cascade-on-delete]}
        :Z :Int})
      (dataflow
       (p :CreateE2)
       {(p :E1)
        {:N? (p :CreateE2.N)} :as :E1}
       {(p :E2)
        {:Y (p :CreateE2.Y)}
        :-> [{(p :R1) {:Z (p :CreateE2.Z)}} :E1]})
      (dataflow
       (p :DeleteE2)
       [:delete (p :E2) {cn/id-attr (p :DeleteE2.Id)}]))
    (let [e11 (tu/first-result
               {(p :Upsert_E1)
                {:Instance
                 {(p :E1)
                  {:N "a" :X 1}}}})
          e12 (tu/first-result
               {(p :Upsert_E1)
                {:Instance
                 {(p :E1)
                  {:N "b" :X 2}}}})
          e21 (tu/result
               {(p :CreateE2)
                {:N "a" :Y 100 :Z 20}})
          e22 (tu/result
               {(p :CreateE2)
                {:N "a" :Y 100 :Z 20}})
          e23 (tu/result
               {(p :CreateE2)
                {:N "b" :Y 200 :Z 40}})
          e24 (tu/result
               {(p :CreateE2)
                {:N "b" :Y 100 :Z 40}})]
      (is (cn/instance-of? (p :E2) e21))
      (defn- check-rel-vals [e1 e2 z r]
        (is (= (:E1 r) e1))
        (is (= (:E2 r) e2))
        (is (= (:Z r) z)))
      (let [r (first (:-> e21))
            t (:transition (first (:-> e22)))
            chk (partial check-rel-vals 1 100 20)]
        (is (cn/instance-of? (p :R1) r))
        (chk r) (chk (:to t)) (chk (:from t))
        (is (= (cn/id-attr (:to t)) (cn/id-attr (:from t)))))
      (let [r (first (:-> e23))]
        (is (cn/instance-of? (p :R1) r))
        (is (= (:E1 r) 2))
        (is (= (:E2 r) 200))
        (is (= (:Z r) 40)))
      (let [r (first (:-> e24))]
        (is (cn/instance-of? (p :R1) r))
        (is (= (:E1 r) 2))
        (is (= (:E2 r) 100))
        (is (= (:Z r) 40)))
      (let [id (cn/id-attr e22)
            f #(tu/eval-all-dataflows
                {(p :DeleteE2)
                 {:Id id}})]
        (if cascade-on-delete
          (is (cn/same-instance?
               (dissoc e22 :->)
               (first (tu/fresult (f)))))
          (is (tu/is-error f)))))))

(deftest issue-649-contains-constraints
  (i649-test 1 false)
  (i649-test 2 true))

(defn- reltype-tests [one-n]
  (let [cn (keyword (str "ReltypeTest" (if one-n 1 0)))
        p (partial tu/make-path cn)]
    (defcomponent cn
      (entity
       (p :A)
       {:X {:type :Int
            :identity true}})
      (entity
       (p :B)
       {:Y {:type :Int
            :identity true}})
      (relationship
       (p :R1)
       {:meta
        {:between [(p :A) (p :B)
                   :one-n one-n]}
        :Z :Int})
      (dataflow
       (p :CreateB)
       {(p :A) {:X? (p :CreateB.X)} :as :A}
       {(p :B)
        {:Y (p :CreateB.Y)}
        :-> [{(p :R1) {:Z (p :CreateB.Z)}} :A]})
      (dataflow
       (p :CreateR1ForA)
       {(p :B) {:Y? (p :CreateR1ForA.Y)} :as :B}
       {(p :A)
        {:X? (p :CreateR1ForA.X)}
        :-> [{(p :R1) {:Z (p :CreateR1ForA.Z)}} :B]}))
    (let [a (tu/first-result
             {(p :Upsert_A)
              {:Instance
               {(p :A) {:X 10}}}})
          b (tu/result
             {(p :CreateB)
              {:X 10 :Y 20 :Z 30}})
          a1 (tu/result
              {(p :CreateR1ForA)
               {:Y 20 :X 10 :Z 40}})]
      (is (cn/instance-of? (p :A) a))
      (is (cn/instance-of? (p :B) b))
      (is (cn/instance-of? (p :A) a1))
      (let [rb (first (:-> b))
            ra (first (:-> a1))
            xyz (fn [r] (mapv #(% r) [:A :B :Z]))]
        (is (cn/instance-of? (p :R1) rb))
        (is (= [10 20 30] (xyz rb)))
        (if one-n
          (let [f (:from (:transition ra))
                t (:to (:transition ra))]
            (is (cn/instance-of? (p :R1) f))
            (is (cn/instance-of? (p :R1) t))
            (is (= [10 20 30] (xyz f)))
            (is (= [10 20 40] (xyz t)))
            (is (= (cn/id-attr f) (cn/id-attr t))))
          (do (is (cn/instance-of? (p :R1) ra))
              (is (= [10 20 40] (xyz ra)))
              (is (not= (cn/id-attr rb) (cn/id-attr ra)))))))))

(deftest n-to-n-relationships
  (reltype-tests false)
  (reltype-tests true))

(deftest relations-on-resultset
  (defcomponent :RoR
    (entity
     :RoR/A
     {:X {:type :Int :indexed true}})
    (entity
     :RoR/B
     {:Y {:type :Int :indexed true}
      :K :Int})
    (relationship
     :RoR/R1
     {:meta
      {:between [:RoR/A :RoR/B :on [:X :Y]]}
      :Z :Int})
    (dataflow
     :RoR/CreateRel
     {:RoR/A {:X? :RoR/CreateRel.X} :as :A}
     {:RoR/B
      {:Y? :RoR/CreateRel.Y}
      :-> [{:RoR/R1 {:Z '(* :RoR/B.K :RoR/CreateRel.Z)}} :A]}))
  (let [a (tu/first-result
           {:RoR/Upsert_A
            {:Instance
             {:RoR/A {:X 10}}}})
        bs (mapv
            (fn [[y k]]
              (tu/first-result
               {:RoR/Upsert_B
                {:Instance
                 {:RoR/B {:Y y :K k}}}}))
            [[1 5] [1 3]])
        rs (tu/result
            {:RoR/CreateRel
             {:X 10 :Y 1 :Z 2}})
        is-b? (partial cn/instance-of? :RoR/B)]
    (is (cn/instance-of? :RoR/A a))
    (is (every? is-b? bs))
    (is (every? is-b? bs))
    (doseq [b rs]
      (let [r1 (first (:-> b))]
        (is (cn/instance-of? :RoR/R1 r1))
        (is (= 10 (:A r1)))
        (is (= 1 (:B r1)))
        (is (= (:Z r1) (* (:K b) 2)))))))

(deftest relations-1-1
  (defcomponent :R11
    (entity
     :R11/A
     {:X {:type :Int :indexed true}})
    (entity
     :R11/B
     {:Y {:type :Int :indexed true}})
    (relationship
     :R11/R
     {:meta
      {:between [:R11/A :R11/B :on [:X :Y]
                 :one-one true]}
      :Z :Int})
    (dataflow
     :R11/CreateR
     {:R11/A {:X? :R11/CreateR.X} :as :A}
     {:R11/B
      {:Y :R11/CreateR.Y}
      :-> [{:R11/R {:Z :R11/CreateR.Z}} :A]}))
  (let [a1 (tu/first-result
            {:R11/Upsert_A
             {:Instance
              {:R11/A {:X 1}}}})
        a2 (tu/first-result
            {:R11/Upsert_A
             {:Instance
              {:R11/A {:X 2}}}})
        b1 (tu/result
            {:R11/CreateR
             {:X 1 :Y 10 :Z 100}})
        b2 (tu/result
            {:R11/CreateR
             {:X 2 :Y 20 :Z 200}})
        p (fn [b y a]
            (is (cn/instance-of? :R11/B b))
            (let [r (first (:-> b))]
              (is (= y (:Y b) (:B r)))
              (is (= a (:A r)))))]
    (p b1 10 1)
    (p b2 20 2)
    (tu/is-error
     #(tu/eval-all-dataflows
       {:R11/CreateR
        {:X 1 :Y 20 :Z 300}}))))

(deftest issue-703-contains-graph
  (defcomponent :I703
    (entity
     :I703/Company
     {:Name {:type :String :identity true}})
    (entity
     :I703/Dept
     {:No {:type :Int :identity true}})
    (entity
     :I703/Employee
     {:FirstName :String
      :LastName :String
      :Email {:type :Email :identity true}})
    (entity
     :I703/Warehouse
     {:Name {:type :String :identity true}
      :Location :String})
    (entity
     :I703/GlobalPreferences
     {:Data :Map})
    (relationship
     :I703/Section
     {:meta {:contains [:I703/Company :I703/Dept]}})
    (relationship
     :I703/WorksFor
     {:meta {:contains [:I703/Dept :I703/Employee]}})
    (relationship
     :I703/Storage
     {:meta {:contains [:I703/Dept :I703/Warehouse]}})
    (relationship
     :I703/ReportsTo
     {:meta {:between [:I703/Employee :I703/Employee]}})
    (event
     :I703/CreateDept
     {:Company :String})
    (dataflow
     :I703/CreateDept
     {:I703/Company {:Name? :I703/CreateDept.Company}
      :as [:C]}
     {:I703/Dept
      {:No 101}
      :-> [{:I703/Section {}} :C]}))
  (let [g (rg/build-graph :I703)]
    (is (= (set [:I703/Company :I703/GlobalPreferences])
           (rg/rep (rg/roots g))))
    (let [paths (rg/paths g :I703/Company)
          subg (rg/descend paths :I703/Section)]
      (is (= (set [:I703/Section]) (rg/rep paths)))
      (is (= (set [:I703/Dept]) (rg/rep (rg/roots subg))))
      (let [paths (rg/paths subg :I703/Dept)
            subg (rg/descend paths :I703/WorksFor)]
        (is (= (set [:I703/WorksFor :I703/Storage]) (rg/rep paths)))
        (is (= (set [:I703/Employee]) (rg/rep (rg/roots subg))))
        (let [n (rg/node-object
                 (rg/paths subg :I703/Employee)
                 :I703/ReportsTo)]
          (is (= :between (:type n)))
          (is (= :I703/Employee (:to n)))
          (is (= :I703/ReportsTo (:relationship n)))))))
  (let [c (tu/first-result
           {:I703/Upsert_Company
            {:Instance
             {:I703/Company {:Name "c1"}}}})
        d (tu/result
           {:I703/CreateDept
            {:Company "c1"}})
        [prelinfo pinst] (first (rg/find-parents d))
        rel-p (cn/relinfo-name prelinfo)
        ptype (cn/relinfo-to prelinfo)
        [crelinfo cinst] (first (rg/find-children c))
        rel-c (cn/relinfo-name crelinfo)
        ctype (cn/relinfo-to crelinfo)]
    (is (= :I703/Section rel-p))
    (is (= :I703/Company ptype))
    (is (cn/same-instance? (first pinst) c))
    (is (= :I703/Section rel-c))
    (is (= :I703/Dept ctype))
    (is (cn/same-instance? (first cinst) d))))

(deftest contains-workspace
  (defcomponent :Fractl.Meta.Core
    (entity
     :Fractl.Meta.Core/User
     {:meta {:inherits :Kernel.Identity/User}})
    (entity
     :Fractl.Meta.Core/Workspace
     {:Name {:type :String
             :indexed true}
      :Models {:listof :Path}})
    (relationship
     :Fractl.Meta.Core/BelongsTo
     {:meta {:contains [:Fractl.Meta.Core/User :Fractl.Meta.Core/Workspace
                        :on [:Email :Name]]}})
    (dataflow
     :Fractl.Meta.Core/SignUp2
     {:Fractl.Meta.Core/User
      {:Email :Fractl.Meta.Core/SignUp2.Email
       :Name :Fractl.Meta.Core/SignUp2.Name
       :FirstName :Fractl.Meta.Core/SignUp2.FirstName
       :LastName :Fractl.Meta.Core/SignUp2.LastName}
      :as :U}
     {:Fractl.Meta.Core/Workspace
      {:Name "Default"
       :Models []}
      :-> [{:Fractl.Meta.Core/BelongsTo {}} :U]})
    (dataflow
     :Fractl.Meta.Core/GetWorkspace
     {:Fractl.Meta.Core/Workspace
      {:Name? :Fractl.Meta.Core/GetWorkspace.WorkspaceName}
      :-> [:Fractl.Meta.Core/BelongsTo?
           {:Fractl.Meta.Core/User
            {:Email? :Fractl.Meta.Core/GetWorkspace.EventContext.User.email}}]}))
  (let [r1 (tu/result
            {:Fractl.Meta.Core/SignUp2
             {:Name "c@c.com", :Email "c@c.com",
              :FirstName "Foo", :LastName "Bar"}})
        r2 (tu/result
            {:Fractl.Meta.Core/SignUp2
             {:Name "d@d.com", :Email "d@d.com",
              :FirstName "Foo", :LastName "Bar"}})
        r3 (tu/result
            {:Fractl.Meta.Core/SignUp2
             {:Name "d@d.com", :Email "d@d.com",
              :FirstName "Foo", :LastName "Bar"}})]
    (defn- check
      ([transition? x]
       (is (and (cn/instance-of? :Fractl.Meta.Core/Workspace x)
                (cn/instance-of?
                 :Fractl.Meta.Core/BelongsTo
                 (if transition?
                   (:to (:transition (first (:-> x))))
                   (first (:-> x)))))))
      ([x] (check false x)))
    (check r1) (check r2) (check true r3)
    (let [r4 (tu/result
              {:Fractl.Meta.Core/GetWorkspace
               {:WorkspaceName "Default"
                :EventContext {:User {:email "d@d.com"}}}})]
      (is (= 1 (count r4)))
      (is (cn/instance-of? :Fractl.Meta.Core/Workspace (first r4)))
      (is (cn/same-instance? (dissoc r3 :->) (first r4))))))
