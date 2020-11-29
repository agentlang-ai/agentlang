(ns fractl.util
  (:require [clojure.string :as string])
  #?(:clj
     (:require [net.cgrand.macrovich :as macros])
     :cljs
     (:require-macros [net.cgrand.macrovich :as macros]
                      [fractl.util :refer [passthru]])))

(defn throw-ex-info
  ([msg errobj]
   (throw (ex-info msg errobj)))
  ([msg] (throw-ex-info msg nil)))

(defn throw-ex
  [msg]
#?(:clj
   (throw (Exception. msg))
   :cljs
   (throw (js/Error. msg))))

(macros/deftime
  (defmacro passthru
    "If the predicate function returns true for exp1, return exp1, otherwise return
  the value defined for alternative. The alternative, if provided,
  must be of the form `:else exp2`. If the alternative is not provided
  and exp1 fail the predicate test, return nil."
    [predicate exp1 & alternative]
    (when (seq alternative)
      (let [k (first alternative)]
        (when-not (= k :else)
          (throw-ex (str "Expected :else, not " k)))))
    `(let [x# ~exp1]
       (if (~predicate x#)
         x#
         ~@(rest alternative)))))

(defn uuid-string []
  #?(:clj
     (str (java.util.UUID/randomUUID))
     :cljs
     (str (random-uuid))))

(defn uuid-from-string [string]
  (try
    #?(:clj
       (java.util.UUID/fromString string)
       :cljs
       (uuid string))
    (catch #?(:clj Exception :cljs :default) _ nil)))

(defn call-safe [f arg]
  (when f (f arg)))

(defn remove-extension [^String filename]
  (let [i (.lastIndexOf filename ".")]
    (if (>= i 0)
      (.substring filename 0 i)
      filename)))

(defn capitalize
  "Convert the first character in a string to upper-case, leave the other
  characters untouched."
  ([string]
   (str (string/upper-case (.charAt string 0)) (subs string 1)))
  ([re jsep string]
   (string/join jsep (map capitalize (string/split string re)))))

(defn lowercase
  "Convert the first character in a string to lower-case, leave the other
  characters untouched."
  ([string]
   (str (string/lower-case (.charAt string 0)) (subs string 1)))
  ([re jsep string]
   (string/join jsep (map lowercase (string/split string re)))))

(defn first-applied
  "Apply each function (fn) to args, return the first truth valued result
  as [tag result]."
  [fn-tags args]
  (loop [fn-tags fn-tags]
    (let [[fn tag] [(first fn-tags) (second fn-tags)]]
      (when (and fn tag)
        (if-let [r (apply fn args)]
          [tag r]
          (recur (rest (rest fn-tags))))))))

(defn- logical-for-each
  [predics arg all?]
  (loop [predics predics, result true]
    (if-let [p (first predics)]
      (let [r (p arg)]
        (if r
          (if all?
            (recur (rest predics) r)
            r)
          (if all?
            r
            (recur (rest predics) r))))
      result)))

(defn all-true?
  "Apply each predicate to arg.
  Return true if all calls return a truth value.
  If predics is an empty sequence, return true."
  [predics arg]
  (logical-for-each predics arg true))

(defn any-true?
  "Apply each predicate to arg.
  Return true if any of the call returns a truth value.
  If predics is an empty sequence, return false."
  [predics arg]
  (logical-for-each predics arg false))

#?(:clj
(defn n-cpu
  "Return number of CPU in the system"
  [] (.availableProcessors (Runtime/getRuntime))))

(defn make-cell
  "A common mutable place for both clj and cljs."
  ([obj]
   #?(:clj (ref obj)
      :cljs (atom obj)))
  ([] (make-cell nil)))

(defn safe-set
  ([cell value result]
   #?(:clj (dosync
            (ref-set cell value))
      :cljs (reset! cell value))
   result)
  ([cell value] (safe-set cell value value)))

(defn safe-set-once [cell f]
  (or @cell (safe-set cell (f))))

(defn safe-set-truth [cell f]
  (when-let [r (f)]
    (safe-set cell r)))

(defn safe-set-first [cell f]
  (let [[a b] (f)]
    (safe-set cell a b)))

(defn apply->
  "Apply args to the first function,
  apply the result to the next function and so on.
  Return the last result."
  ([selector fns args]
   (loop [fs fns, result args]
     (if-let [f (first fs)]
       (recur (rest fs)
              (apply f result))
       (selector result))))
  ([fns args] (apply-> identity fns args)))

(defn map-when [f xs]
  (map #(when % (f %)) xs))
