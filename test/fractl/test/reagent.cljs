(ns fractl.test.reagent
  (:require [cljs.test :refer-macros [deftest is]]
            [fractl.lang
             :refer [event entity dataflow]]
            [fractl.component :as cn]
            [fractl.evaluator :as e]
            [fractl.store :as store]
            [fractl.resolver.core :as r]
            [fractl.resolver.registry :as rg]
            [fractl.test.util :as tu :refer-macros [defcomponent]]))

(def store (store/open-reagent-store nil))

(defn- test-resolver [install-resolver resolver-name path]
  (let [r (r/make-resolver resolver-name {:upsert {:handler identity}
                                          :delete {:handler (fn [x] x)}})]
    (install-resolver path r)))

(def compose-test-resolver (partial test-resolver rg/compose-resolver))
(def override-test-resolver (partial test-resolver rg/override-resolver))

(defn- persisted? [comp-name entity-instance]
  (let [id (:Id entity-instance)
        evt (cn/make-instance (keyword (str (name comp-name) "/Lookup_E")) {:Id id})
        result (e/eval-all-dataflows evt store nil)
        r (first result)]
    (when-not (= :not-found (:status r))
      (let [e (ffirst (:result r))]
        (cn/same-instance? entity-instance e)))))

(deftest store-test
  (defcomponent :ST
    (entity {:ST/E {:X :Kernel/Int}})

    (event {:ST/NewE {:X :Kernel/Int}})

    (dataflow :ST/NewE
              {:ST/E {:X :ST/NewE.X}}
              :ST/E.X))

  (let [e (cn/make-instance :ST/E {:X 10})
        evt (cn/make-instance :ST/Upsert_E {:Instance e})
        result (tu/fresult (e/eval-all-dataflows evt store nil))
        e01 (ffirst result)]
    (is (cn/instance-of? :ST/E e01))
    (is (nil? (second result)))
    (is (persisted? :ST e01)))
  (compose-test-resolver :TestResolver01 :ST/E)
  (let [e (cn/make-instance :ST/E {:X 10})
        evt (cn/make-instance :ST/Upsert_E {:Instance e})
        result (tu/fresult (e/eval-all-dataflows evt store nil))
        e01 (ffirst result)
        r (ffirst (second result))]
    (is (cn/instance-of? :ST/E e01))
    (is (persisted? :ST e01))
    (is (cn/instance-of? :ST/E r))
    (is (= e01 r))
    (let [evt (cn/make-instance :ST/NewE {:X 100})
          result (tu/fresult (e/eval-all-dataflows evt store nil))]
      (is (= :cursor (first result)))
      (let [cursor (second result)]
        (is (vector? cursor))
        (is (= [:ST :E] (first cursor)))
        (is (= :X (last cursor)))))))
