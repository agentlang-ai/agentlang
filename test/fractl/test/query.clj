(ns fractl.test.query
  #?(:clj (:use [fractl.lang]))
  (:require [clojure.test :refer [deftest is]]
            #?(:clj [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])
            [fractl.component :as cn])
  #?(:cljs [fractl.lang
            :refer [component attribute event
                    entity record dataflow]]))

(def eval-all-dataflows-for-event (tu/make-df-eval))

(deftest q01
  (defcomponent :Q01
    (entity {:Q01/E {:X :Kernel/Int}}))
  (let [e (cn/make-instance :Q01/E {:X 10})
        evt (cn/make-instance :Q01/Create_E {:Instance e})
        e1 (ffirst (tu/fresult (eval-all-dataflows-for-event evt)))
        id (:Id e1)
        evt (cn/make-instance :Q01/Lookup_E {:Id id})
        e2 (ffirst (tu/fresult (eval-all-dataflows-for-event evt)))]
    (is (cn/instance-of? :Q01/E e2))
    (is (cn/same-instance? e1 e2))))

(deftest q02
  (defcomponent :Q02
    (entity {:Q02/E {:X {:type :Kernel/Int
                         :indexed true}
                     :Y {:type :Kernel/Int
                         :indexed true}}})
    (event {:Q02/QE01 {:Y :Kernel/Int}})
    (dataflow :Q02/QE01
              {:Q02/E {:X? [:>= 10]
                       :Y :Q02/QE01.Y}})
    (event {:Q02/QE02 {:X :Kernel/Int
                       :Y :Kernel/Int}})
    (dataflow :Q02/QE02
              {:Q02/E {:X? [:>= :Q02/QE02.X]
                       :Y? :Q02/QE02.Y}}))
  (let [es [(cn/make-instance :Q02/E {:X 10 :Y 4})
            (cn/make-instance :Q02/E {:X 12 :Y 6})
            (cn/make-instance :Q02/E {:X 9 :Y 3})]
        evts (map #(cn/make-instance :Q02/Create_E {:Instance %}) es)
        f (comp ffirst #(:result (first (eval-all-dataflows-for-event %))))
        insts (map f evts)
        ids (map :Id insts)]
    (is (every? true? (map #(cn/instance-of? :Q02/E %) insts)))
    (let [evt01 (cn/make-instance :Q02/QE01 {:Y 100})
          r01 (first (tu/fresult (eval-all-dataflows-for-event evt01)))
          evt02 (cn/make-instance :Q02/QE02 {:X 10 :Y 100})
          r02 (first (tu/fresult (eval-all-dataflows-for-event evt02)))]
      (is (= 2 (count r01)))
      (is (every? #(and (>= (:X %) 10) (= (:Y %) 100)) r01))
      (is (= 2 (count r02)))
      (is (every? #(and (>= (:X %) 10) (= (:Y %) 100)) r02)))))
