(ns fractl.test.features02
  (:require #?(:clj [clojure.test :refer [deftest is]]
               :cljs [cljs.test :refer-macros [deftest is]])
            [clojure.string :as s]
            [fractl.component :as cn]
            [fractl.lang
             :refer [component attribute event
                     entity record relationship
                     dataflow]]
            [fractl.lang.raw :as raw]
            [fractl.lang.syntax :as ls]
            [fractl.lang.relgraph :as rg]
            [fractl.lang.internal :as li]
            [fractl.evaluator :as e]
            #?(:clj [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])))

(deftest issue-840-raw-attributes
  (defcomponent :I840
    (attribute :I840/K {:type :String})
    (entity
     :I840/E
     {:X :Int
      :Y {:type :String :default "yyyy"}
      :Z :I840/K}))
  (is (= {:X :Int
          :Y {:type :String
              :default "yyyy"}
          :Z :I840/K}
         (raw/find-entity :I840/E))))

(deftest fetch-from-raw
  (defcomponent :Ffr
    (entity
     :Ffr/E
     {:Id :Identity
      :rbac [{:roles ["user"] :allow [:create]}]})
    (entity
     :Ffr/F
     {:X {:type :Int tu/guid true}})
    (relationship
     :Ffr/R
     {:meta {:between [:Ffr/E :Ffr/F]}
      :Y :Int}))
  (= {:Id :Identity
      :rbac [{:roles ["user"] :allow [:create]}]}
     (cn/fetch-user-schema :Ffr/E))
  (= {:X {:type :Int tu/guid true}}
     (cn/fetch-user-schema :Ffr/F))
  (= {:meta {:between [:Ffr/E :Ffr/F], :cascade-on-delete true}, :Y :Int}
     (cn/fetch-user-schema :Ffr/R)))

(deftest basic-contains-relationship
  (let [grades ["a" "b"]]
    (defcomponent :Bcr
      (entity
       :Bcr/Employee
       {:Email {:type :Email tu/guid true}
        :Name :String
        :Grade {:oneof grades}})
      (entity
       :Bcr/Department
       {:Name {:type :String tu/guid true}
        :Location {:oneof ["north" "south" "west" "east"]}})
      (relationship
       :Bcr/WorksFor
       {:meta {:contains [:Bcr/Department :Bcr/Employee]}}))
    (is (cn/parent-via? :Bcr/WorksFor :Bcr/Employee :Bcr/Department))
    (let [fq (partial li/as-fully-qualified-path :Bcr)
          d1 (tu/first-result
              {:Bcr/Create_Department
               {:Instance
                {:Bcr/Department
                 {:Name "d1" :Location "south"}}}})
          [e1 e2 :as es] (mapv #(tu/first-result
                                 {:Bcr/Create_Employee
                                  {:Instance
                                   {:Bcr/Employee
                                    {:Email (str % "@bcr.com")
                                     :Name % :Grade (rand-nth grades)}}
                                   li/path-attr "/Department/d1/WorksFor"}})
                               ["e01" "e02"])
          d? (tu/type-check :Bcr/Department)
          e? (tu/type-check :Bcr/Employee)]
      (is (d? d1)) (is (every? e? es))
      (defn- lookup-e [e]
        (is (cn/same-instance?
             e (tu/first-result
                {:Bcr/Lookup_Employee
                 {li/path-attr
                  (fq (str "path://Department/d1/WorksFor/Employee/" (:Email e)))}}))))
      (doseq [e es] (lookup-e e))
      (defn- lookup-all-es [dept cnt es]
        (let [result (first
                      (tu/eval-all-dataflows
                       {:Bcr/LookupAll_Employee
                        {li/path-attr (fq (str "path://Department/" dept "/WorksFor/Employee/%"))}}))
              rs (when (= :ok (:status result)) (:result result))]
          (if (zero? cnt)
            (is (tu/not-found? result))
            (do (is (= (count rs) cnt))
                (is (every? (fn [e] (some (partial cn/same-instance? e) es)) rs))))))
      (lookup-all-es "d1" 2 es)
      (let [e (tu/first-result
               {:Bcr/Update_Employee
                {:Data {:Name "e0001"}
                 li/path-attr (fq "path://Department/d1/WorksFor/Employee/e01@bcr.com")}})]
        (is (= "e0001" (:Name e)))
        (is (= (:Email e1) (:Email e)))
        (lookup-e e)
        (lookup-all-es "d1" 2 [e e2])
        (is (cn/same-instance? e (tu/first-result
                                  {:Bcr/Delete_Employee
                                   {li/path-attr (fq "path://Department/d1/WorksFor/Employee/e01@bcr.com")}})))
        (lookup-all-es "d1" 1 [e2]))
      (is (d? (tu/first-result {:Bcr/Delete_Department {:Name "d1"}})))
      (lookup-all-es "d1" 0 nil))))

(deftest multi-level-contains
  (defcomponent :Mlc
    (entity
     :Mlc/A
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Mlc/B
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (entity
     :Mlc/C
     {:Id {:type :Int tu/guid true}
      :Z :Int})
    (relationship
     :Mlc/R1
     {:meta {:contains [:Mlc/A :Mlc/B]}})
    (relationship
     :Mlc/R2
     {:meta {:contains [:Mlc/B :Mlc/C]}}))
  (let [as (mapv #(tu/first-result
                   {:Mlc/Create_A
                    {:Instance
                     {:Mlc/A
                      {:Id % :X (* % 2)}}}})
                 [1 2])
        create-b #(tu/first-result {:Mlc/Create_B
                                    {:Instance
                                     {:Mlc/B
                                      {:Id %2 :Y (* %2 5)}}
                                     li/path-attr %1}})
        create-c #(tu/first-result {:Mlc/Create_C
                                    {:Instance
                                     {:Mlc/C
                                      {:Id %2 :Z (* %2 10)}}
                                     li/path-attr %1}})
        a? (tu/type-check :Mlc/A)
        b? (tu/type-check :Mlc/B)
        c? (tu/type-check :Mlc/C)
        b1 (create-b "/A/1/R1" 10)
        b2 (create-b "/A/2/R1" 20)
        c11 (create-c "/A/1/R1/B/10/R2" 100)
        fq (partial li/as-fully-qualified-path :Mlc)]
    (is (every? a? as))
    (is (every? b? [b1 b2]))
    (is (c? c11))
    (is (= "path://Mlc$A/1/Mlc$R1/Mlc$B/10/Mlc$R2/Mlc$C/100"
           (li/path-attr c11)))
    (is (tu/is-error #(create-c "/A/10/R1/B/10/R2" 200)))
    (is (tu/is-error #(create-c "/A/1/R1/B/1000/R2" 200)))
    (let [rs (tu/result
              {:Mlc/LookupAll_B
               {li/path-attr (fq "path://A/1/R1/B/%")}})]
      (is (= 1 (count rs)))
      (is (b? (first rs))))
    (let [rs (tu/result
              {:Mlc/LookupAll_C
               {li/path-attr (fq "path://A/1/R1/B/10/R2/C/%")}})]
      (is (= 1 (count rs)))
      (is (c? (first rs))))
    (is (cn/same-instance? (first as) (tu/first-result {:Mlc/Delete_A {:Id 1}})))
    (is (tu/not-found? (tu/eval-all-dataflows
                        {:Mlc/LookupAll_B
                         {li/path-attr (fq "path://A/1/R1/B/%")}})))
    (is (tu/not-found? (tu/eval-all-dataflows
                        {:Mlc/LookupAll_C
                         {li/path-attr (fq "path://A/1/R1/B/10/R2/C/%")}})))))

(deftest basic-between-relationships
  (defcomponent :Bbr
    (entity
     :Bbr/A
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Bbr/B
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (relationship
     :Bbr/R
     {:meta {:between [:Bbr/A :Bbr/B]}
      :Z :Int})
    (dataflow
     :Bbr/LookupB
     {:Bbr/B {:Y? :Bbr/LookupB.Y}
      :-> [[{:Bbr/R {:A? :Bbr/LookupB.A}}]]}))
  (let [a1 (tu/first-result
            {:Bbr/Create_A
             {:Instance
              {:Bbr/A {:Id 1 :X 100}}}})
        b1 (tu/first-result
            {:Bbr/Create_B
             {:Instance
              {:Bbr/B {:Id 2 :Y 200}}}})
        a? (tu/type-check :Bbr/A)
        b? (tu/type-check :Bbr/B)
        r? (tu/type-check :Bbr/R)]
    (is (a? a1))
    (is (b? b1))
    (let [create-r (fn [a b z]
                     (tu/first-result
                      {:Bbr/Create_R
                       {:Instance
                        {:Bbr/R
                         {:A a :B b :Z z}}}}))]
      (is (r? (create-r 1 2 300)))
      (tu/is-error #(create-r 3 2 400))
      (let [rs (tu/result
                {:Bbr/LookupB {:Y 200 :A 1}})]
        (is (= 1 (count rs)))
        (is (cn/same-instance? b1 (first rs)))))))

(deftest between-and-contains
  (defcomponent :Bac
    (entity
     :Bac/A
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Bac/B
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (entity
     :Bac/C
     {:Id {:type :Int tu/guid true}
      :Z :Int})
    (relationship
     :Bac/Rc
     {:meta {:contains [:Bac/A :Bac/B]}})
    (relationship
     :Bac/Rb
     {:meta {:between [:Bac/B :Bac/C]}})
    (dataflow
     :Bac/LookupB
     {:Bac/B {li/path-attr? :Bac/LookupB.Rc}
      :-> [[{:Bac/Rb {:C? :Bac/LookupB.C}}]]}))
  (let [create-a #(tu/first-result
                   {:Bac/Create_A
                    {:Instance
                     {:Bac/A {:Id % :X (* % 2)}}}})
        mkpath #(str "/A/" % "/Rc")
        create-b #(tu/first-result
                   {:Bac/Create_B
                    {:Instance
                     {:Bac/B {:Id %2 :Y (* %2 5)}}
                     li/path-attr (mkpath %1)}})
        create-c #(tu/first-result
                   {:Bac/Create_C
                    {:Instance
                     {:Bac/C {:Id % :Z (* % 10)}}}})
        create-rb #(tu/first-result
                    {:Bac/Create_Rb
                     {:Instance
                      {:Bac/Rb {:B %1 :C %2}}}})
        a? (tu/type-check :Bac/A)
        b? (tu/type-check :Bac/B)
        c? (tu/type-check :Bac/C)
        rb? (tu/type-check :Bac/Rb)
        as (mapv create-a [1 2 3])
        [b1 b2 b3 :as bs] (mapv create-b [1 2 3] [4 5 4])
        cs (mapv create-c [7 8 9])
        fq (partial li/as-fully-qualified-path :Bac)
        rbs (mapv create-rb [(li/id-attr b1) (li/id-attr b3) (li/id-attr b1)] [7 7 9])]
    (is (every? a? as))
    (is (every? b? bs))
    (is (every? c? cs))
    (is (every? rb? rbs))
    (is (cn/same-instance? b1 (tu/first-result
                               {:Bac/LookupB
                                {:B 4 :Rc (fq "/A/1/Rc/B/4") :C 7}})))))

(deftest multi-contains
  (defcomponent :Mcs
    (entity
     :Mcs/A
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Mcs/B
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (entity
     :Mcs/C
     {:Id {:type :Int tu/guid true}
      :Z :Int})
    (relationship
     :Mcs/R1
     {:meta {:contains [:Mcs/A :Mcs/C]}})
    (relationship
     :Mcs/R2
     {:meta {:contains [:Mcs/B :Mcs/C]}}))
  (let [a1 (tu/first-result
            {:Mcs/Create_A
             {:Instance
              {:Mcs/A
               {:Id 1 :X 2}}}})
        b1 (tu/first-result
            {:Mcs/Create_B
             {:Instance
              {:Mcs/B
               {:Id 2 :Y 20}}}})
        create-c #(tu/first-result {:Mcs/Create_C
                                    {:Instance
                                     {:Mcs/C
                                      {:Id %2 :Z (* %2 10)}}
                                     li/path-attr %1}})
        a? (tu/type-check :Mcs/A)
        b? (tu/type-check :Mcs/B)
        c? (tu/type-check :Mcs/C)
        c1 (create-c "/A/1/R1" 10)
        c2 (create-c "/B/2/R2" 100)]
    (is (a? a1)) (is (b? b1))
    (is (every? c? [c1 c2]))
    (is (= "path://Mcs$A/1/Mcs$R1/Mcs$C/10" (li/path-attr c1)))
    (is (= "path://Mcs$B/2/Mcs$R2/Mcs$C/100" (li/path-attr c2)))
    (is (tu/is-error #(create-c "/A/1/R2" 20)))
    (is (tu/is-error #(create-c "/B/1/R2" 200)))))

(deftest contains-by-local-ref
  (defcomponent :Cblr
    (entity
     :Cblr/P
     {:Id :Identity
      :X :Int})
    (entity
     :Cblr/C
     {:Id :Identity
      :Y :Int})
    (entity
     :Cblr/D
     {:Id :Identity
      :Z :Int})
    (relationship
     :Cblr/R
     {:meta {:contains [:Cblr/P :Cblr/C]}})
    (relationship
     :Cblr/S
     {:meta {:contains [:Cblr/C :Cblr/D]}})
    (dataflow
     :Cblr/MakeC
     {:Cblr/P {:X :Cblr/MakeC.X} :as :P}
     {:Cblr/C {:Y :Cblr/MakeC.Y} :-> [[:Cblr/R :P]]})
    (defn cblr-make-p-path [p c]
      (cn/instance-to-full-path :Cblr/C c p))
    (dataflow
     :Cblr/FindC
     {:Cblr/P {:Id? :Cblr/FindC.P} :as [:P]}
     [:eval '(fractl.test.features02/cblr-make-p-path :P :Cblr/FindC.C) :as :P]
     {:Cblr/C {:Y? :Cblr/FindC.Y li/path-attr? :P}})
    (dataflow
     :Cblr/MakeD
     {:Cblr/C {li/path-attr? :Cblr/MakeD.C} :as [:C]}
     {:Cblr/D {:Z :Cblr/MakeD.Z} :-> [[:Cblr/S :C]]}))
  (let [c? (partial cn/instance-of? :Cblr/C)
        p? (partial cn/instance-of? :Cblr/P)
        pid #(second (filter seq (s/split (li/path-query-string (li/path-attr %)) #"/")))
        make-c #(tu/first-result
                 {:Cblr/MakeC {:X %1 :Y %2}})
        c1 (make-c 1 10)
        c2 (make-c 1 20)
        lookup-p #(tu/first-result
                   {:Cblr/Lookup_P {:Id %}})
        lookup-c #(tu/first-result
                   {:Cblr/Lookup_C {li/path-attr %}})
        make-d #(tu/first-result
                 {:Cblr/MakeD {:C %1 :Z %2}})
        d? (partial cn/instance-of? :Cblr/D)
        cpath #(subs % 0 (s/index-of % "/Cblr$S"))]
    (is (c? c1))
    (is (c? c2))
    (let [p (pid c1)
          p1 (lookup-p p)
          cid (:Id c1)]
      (is (p? p1))
      (is (= p (:Id p1)))
      (is (cn/same-instance? c1 (tu/first-result
                                 {:Cblr/FindC
                                  {:P p :C cid :Y 10}}))))
    (is (cn/same-instance? c1 (lookup-c (li/path-attr c1))))
    (let [d1 (make-d (li/path-attr c1) 200)]
      (is (d? d1))
      (is (pos? (s/index-of (li/path-attr d1) "/Cblr$S")))
      (is (cn/same-instance? c1 (lookup-c (cpath (li/path-attr d1))))))))

(deftest issue-1138-fire-dynamic-events
  (let [x (atom 0)]
    (defn add-to-x! [v]
      (reset! x (+ @x v)))
    (defcomponent :I1138
      (event
       :I1138/Evt
       {:X :Int})
      (entity
       :I1138/E
       {:Evt :I1138/Evt})
      (dataflow
       :I1138/Evt
       [:eval '(fractl.test.features02/add-to-x! :I1138/Evt.X)]
       :I1138/Evt)
      (dataflow
       :I1138/FireEvt
       [:eval :I1138/FireEvt.E.Evt]
       :I1138/FireEvt.E))
    (let [e (tu/result
             {:I1138/FireEvt
              {:E {:I1138/E
                   {:Evt {:I1138/Evt {:X 1}}}}}})]
      (is (cn/instance-of? :I1138/E e))
      (is (= 1 @x)))))

(deftest purge-delete-cascades
  (defcomponent :Dac
    (entity
     :Dac/P
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Dac/C
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (relationship
     :Dac/R
     {:meta {:contains [:Dac/P :Dac/C]}})
    (dataflow
     :Dac/PurgeAll
     [:delete :Dac/P :purge]))
  (let [p (tu/first-result
           {:Dac/Create_P
            {:Instance {:Dac/P {:Id 1 :X 10}}}})
        p2 (tu/first-result
            {:Dac/Create_P
             {:Instance {:Dac/P {:Id 2 :X 20}}}})
        cs (mapv #(tu/first-result
                   {:Dac/Create_C
                    {:Instance {:Dac/C {:Id % :Y (* 2 %)}}
                     li/path-attr "/P/1/R"}})
                 [10 20])
        cs2 (mapv #(tu/first-result
                    {:Dac/Create_C
                     {:Instance {:Dac/C {:Id % :Y (* 2 %)}}
                      li/path-attr "/P/2/R"}})
                  [10 20])
        fq (partial li/as-fully-qualified-path :Dac)
        allcs (fn [p f chk]
                (let [cs (f
                          {:Dac/LookupAll_C
                           {li/path-attr (fq (str "path://P/" p "/R/C/%"))}})]
                  (when chk
                    (is (= 2 (count cs)))
                    (is (every? (partial cn/instance-of? :Dac/C) cs))
                    (is (every? #(s/starts-with?
                                  (li/path-attr %)
                                  (fq (str "path://P/" p "/R/C")))
                                cs)))
                  cs))]
    (is (cn/instance-of? :Dac/P p))
    (is (cn/instance-of? :Dac/P p2))
    (is (= 2 (count cs)))
    (is (every? (partial cn/instance-of? :Dac/C) cs))
    (is (= 2 (count cs2)))
    (is (every? (partial cn/instance-of? :Dac/C) cs2))
    (allcs 1 tu/result true)
    (allcs 2 tu/result true)
    (is (cn/same-instance? p (tu/first-result
                              {:Dac/Lookup_P {:Id 1}})))
    (is (cn/same-instance? p (tu/first-result
                              {:Dac/Delete_P {:Id 1}})))
    (is (tu/not-found? (tu/eval-all-dataflows
                        {:Dac/Lookup_P {:Id 1}})))
    (is (tu/not-found? (allcs 1 tu/eval-all-dataflows false)))
    (is (= :ok (:status (first (tu/eval-all-dataflows {:Dac/PurgeAll {}})))))
    (is (cn/same-instance? p2 (tu/first-result {:Dac/Lookup_P {:Id 2}})))
    (allcs 2 tu/result true)))

(deftest query-by-parent-pattern
  (defcomponent :Qpp
    (entity
     :Qpp/P
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :Qpp/C
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (relationship
     :Qpp/R
     {:meta {:contains [:Qpp/P :Qpp/C]}})
    (dataflow
     :Qpp/FindC
     {:Qpp/P {:Id? :Qpp/FindC.P} :as [:P]}
     {:Qpp/C {:Y? :Qpp/FindC.Y}
      :-> [[:Qpp/R? :P :Qpp/FindC.C]]}))
  (let [p (tu/first-result
           {:Qpp/Create_P
            {:Instance {:Qpp/P {:Id 1 :X 10}}}})
        c1 (tu/first-result
            {:Qpp/Create_C
             {:Instance {:Qpp/C {:Id 2 :Y 100}}
              li/path-attr "/P/1/R"}})
        c2 (tu/first-result
            {:Qpp/FindC {:Y 100 :P 1 :C 2}})]
    (is (cn/instance-of? :Qpp/P p))
    (is (cn/same-instance? c1 c2))))

(defn- globally-unique-test [c flag]
  (let [mp (partial li/make-path c)]
    (defcomponent c
      (entity
       (mp :P)
       {:Id {:type :Int tu/guid true}
        :X :Int})
      (entity
       (mp :C)
       {:Id {:type :Int tu/guid true}
        :Y :Int})
      (relationship
       (mp :R)
       {:meta {:contains [(mp :P) (mp :C)]
               :globally-unique flag}}))
    (let [create-p #(tu/first-result
                     {(mp :Create_P)
                      {:Instance
                       {(mp :P) {:Id % :X (* 10 %)}}}})
          [p1 p2] (mapv create-p [1 2])
          create-c #(tu/first-result
                     {(mp :Create_C)
                      {:Instance
                       {(mp :C) {:Id %2 :Y (* 100 %2)}}
                       li/path-attr (str "/P/" %1 "/R")}})
          c1 (create-c 1 2)
          c2 (create-c 2 2)
          c3 (create-c 2 3)
          p? (partial cn/instance-of? (mp :P))
          c? (partial cn/instance-of? (mp :C))
          fq (partial li/as-fully-qualified-path c)
          lookup-c #(tu/eval-all-dataflows
                     {(mp :Lookup_C)
                      {li/path-attr (fq (str "path://P/" %1 "/R/C/" %2))}})]
      (is (every? p? [p1 p2]))
      (is (every? c? [c1 c2 c3]))
      (is (cn/same-instance? c1 (tu/ffresult (lookup-c 1 2))))
      (if flag
        (is (tu/not-found? (lookup-c 2 2)))
        (is (cn/same-instance? c2 (tu/ffresult (lookup-c 2 2)))))
      (is (cn/same-instance? c3 (tu/ffresult (lookup-c 2 3)))))))

(deftest issue-961-globally-unique
  (globally-unique-test :I961A true)
  (globally-unique-test :I961B false))

(deftest relationship-cardinality
  (defcomponent :RelCard
    (entity
     :RelCard/A
     {:Id {:type :Int tu/guid true}
      :X :Int})
    (entity
     :RelCard/B
     {:Id {:type :Int tu/guid true}
      :Y :Int})
    (relationship
     :RelCard/R1
     {:meta {:between [:RelCard/A :RelCard/B]}})
    (relationship
     :RelCard/R2
     {:meta {:between [:RelCard/A :RelCard/B :one-n true]}})
    (relationship
     :RelCard/R3
     {:meta {:between [:RelCard/A :RelCard/B :one-one true]}}))
  (let [create-a (fn [id]
                   (tu/first-result
                    {:RelCard/Create_A
                     {:Instance
                      {:RelCard/A
                       {:Id id :X (* id 10)}}}}))
        create-b (fn [id]
                   (tu/first-result
                    {:RelCard/Create_B
                     {:Instance
                      {:RelCard/B
                       {:Id id :Y (* id 20)}}}}))
        a? (partial cn/instance-of? :RelCard/A)
        b? (partial cn/instance-of? :RelCard/B)
        as (mapv create-a [1 2 3])
        bs (mapv create-b [10 20 30])
        create-r1 (fn [a b]
                    (tu/first-result
                     {:RelCard/Create_R1
                      {:Instance
                       {:RelCard/R1
                        {:A a :B b}}}}))
        lookup-r1 (fn [id]
                    (tu/first-result
                     {:RelCard/Lookup_R1 {cn/id-attr id}}))
        r1? (partial cn/instance-of? :RelCard/R1)
        create-r2 (fn [a b]
                    (tu/first-result
                     {:RelCard/Create_R2
                      {:Instance
                       {:RelCard/R2
                        {:A a :B b}}}}))
        lookup-r2 (fn [id]
                    (tu/first-result
                     {:RelCard/Lookup_R2 {cn/id-attr id}}))
        r2? (partial cn/instance-of? :RelCard/R2)
        create-r3 (fn [a b]
                    (tu/first-result
                     {:RelCard/Create_R3
                      {:Instance
                       {:RelCard/R3
                        {:A a :B b}}}}))
        lookup-r3 (fn [id]
                    (tu/first-result
                     {:RelCard/Lookup_R3 {cn/id-attr id}}))
        r3? (partial cn/instance-of? :RelCard/R3)
        r-with-ids (fn [cr r? a b]
                     (let [r (cr a b)
                           id (cn/id-attr r)]
                       (and (r? r)
                            (= a (:A r))
                            (= b (:B r))
                            id)))
        r1-with-ids (partial r-with-ids create-r1 r1?)
        r2-with-ids (partial r-with-ids create-r2 r2?)
        r3-with-ids (partial r-with-ids create-r3 r3?)]
    (is (and (= 3 (count as)) (every? a? as)))
    (is (and (= 3 (count bs)) (every? b? bs)))
    (let [r10 (r1-with-ids 1 10)
          r11 (r1-with-ids 1 10)
          r12 (is (r1-with-ids 1 20))]
      (is (and r10 r11 r12))
      (is (r1? (lookup-r1 r10)))
      (is (r1? (lookup-r1 r11)))
      (is (r1? (lookup-r1 r12)))
      (is (r1-with-ids 2 30)))
    (let [r20 (r2-with-ids 1 10)
          r21 (r2-with-ids 1 10)
          r22 (r2-with-ids 1 20)
          r23 (r2-with-ids 2 30)]
      (is (and r20 r21 r22 r23))
      (is (r2? (lookup-r2 r20)))
      (is (not (r2? (lookup-r2 r21))))
      (is (not (r2? (lookup-r2 r22))))
      (is (r2? (lookup-r2 r23))))
    (let [r30 (r3-with-ids 1 10)
          r31 (r3-with-ids 1 10)
          r32 (r3-with-ids 1 20)
          r33 (r3-with-ids 2 30)]
      (is (and r30 r31 r32 r33))
      (is (r3? (lookup-r3 r30)))
      (is (not (r3? (lookup-r3 r31))))
      (is (r3? (lookup-r3 r32)))
      (is (r3? (lookup-r3 r33))))))
