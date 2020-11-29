(ns fractl.test.util
  (:require [clojure.test :refer [is]]
<<<<<<< HEAD
            [fractl.store :as store]
            [fractl.evaluator :as e]))
=======
            [fractl.store :as store]))
>>>>>>> 8e0ecde (fixup! Drop this commit)

(defn- report-expected-ex [ex]
  (println (str "Expected exception in test: "
                #?(:clj (.getMessage ex)
                   :cljs ex)))
  ex)

(defn is-error [f]
  (is (try
        (do (f) false)
        #?(:clj (catch Exception ex
                  (report-expected-ex ex))
           (catch js/Error e
             (report-expected-ex e))))))

(defmacro defcomponent [component & body]
  `(do (fractl.lang/component ~component)
       ~@body
       (store/create-schema (store/open-default-store nil) ~component)
       ~component))

<<<<<<< HEAD
(defn fresult [r]
  (:result (first r)))

(def store (store/open-default-store))

(defn make-df-eval []
  (let [[compile-query-fn evaluator] (e/make store)]
    (partial e/run-dataflows compile-query-fn evaluator)))
=======
(def fresult (comp :result first))
>>>>>>> 8e0ecde (fixup! Drop this commit)
