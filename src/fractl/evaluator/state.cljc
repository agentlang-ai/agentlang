(ns fractl.evaluator.state
  (:require [fractl.util :as u]))

(def ^:private active-state (u/make-cell nil))

(defn set-active-state! [evaluator store]
  (when-not @active-state
    (u/safe-set active-state {:evaluator evaluator
                              :store store})))

(defn get-active-evaluator [] (:evaluator @active-state))
(defn get-active-store [] (:store @active-state))

(def ^:private safe-eval-patterns (atom nil))

(defn set-safe-eval-patterns! [f] (reset! safe-eval-patterns f))
(defn get-safe-eval-patterns [] @safe-eval-patterns)
