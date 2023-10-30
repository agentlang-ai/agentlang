(ns fractl.policy
  (:require [fractl.util :as u]
            [fractl.evaluator :as ev]
            [fractl.component :as cn]
            [fractl.lang.internal :as li]))

(defn- normalize-path [p]
  (if (li/parsed-path? p)
    (li/make-path p)
    p))

(declare lookup-container-policies)

(defn lookup-policies [intercept resource]
  (or
   (let [result
         (ev/eval-all-dataflows
          {:Fractl.Kernel.Lang/LoadPolicies
           {:Intercept (u/keyword-as-string intercept)
            :Resource (u/keyword-as-string (normalize-path resource))}})]
     (ev/ok-result result true))
   (lookup-container-policies intercept resource)))

(defn- lookup-container-policies [intercept resource]
  (when-let [c (cn/fetch-container resource)]
    (lookup-policies intercept c)))

(defn create-policy [intercept resource spec]
  (let [result
        (ev/eval-all-dataflows
         {:Fractl.Kernel.Lang/Create_Policy
          {:Instance
           {:Fractl.Kernel.Lang/Policy
            {:Intercept (u/keyword-as-string intercept)
             :Resource (u/keyword-as-string (normalize-path resource))
             :Spec [:q# spec]}}}})]
    (u/ok-result result)))

(def spec :Spec)
