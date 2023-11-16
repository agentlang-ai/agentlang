(ns fractl.util
  (:require [clojure.string :as string]
            [clojure.pprint :as pp]
            #?(:clj [clojure.java.io :as io])
            [fractl.util.logger :as log]
            [fractl.datafmt.json :as json])
  #?(:clj
     (:require [net.cgrand.macrovich :as macros])
     :cljs
     (:require-macros [net.cgrand.macrovich :as macros]
                      [fractl.util :refer [passthru]]))
  #?(:clj
     (:import [java.io File]
              [org.apache.commons.io FilenameUtils]
              [org.apache.commons.exec CommandLine Executor DefaultExecutor])))

(def host-runtime #?(:clj :jvm :cljs :js))

(defn host-is-jvm? [] (= host-runtime :jvm))

(defn host-os []
  #?(:clj
     (keyword (first (string/split (string/lower-case (System/getProperty "os.name")) #" ")))
     :cljs :js))

(def ^:private script-extn (atom ".fractl"))

(defn set-script-extn! [extn]
  (reset! script-extn extn))

(defn get-script-extn []
  @script-extn)

(def ^:private model-script-name (atom ""))

(defn get-model-script-name []
  (str "model" @script-extn))

(defn file-extension [s]
  #?(:clj
     (str "." (FilenameUtils/getExtension s))
     :cljs
     (second (re-find #"(\.[a-zA-Z0-9]+)$" s))))

(defn fractl-script? [f]
  (= @script-extn (file-extension (str f))))

(defn throw-ex-info
  ([msg errobj]
   (throw (ex-info msg errobj)))
  ([msg] (throw-ex-info msg nil)))

(defn throw-ex
  [msg]
  #?(:clj
     (throw (Exception. msg))
     :cljs
     (let [e (js/Error. msg)]
       (println msg)
       (.log js/console (.-stack e))
       (throw e))))

(defn ok-result
  ([result safe]
   (let [f (if (map? result) result (first result))]
     (if (= :ok (:status f))
       (:result f)
       (let [msg (str "unexpected result: " result)]
         (if safe
           (do (log/warn msg) nil)
           (throw-ex msg))))))
  ([result] (ok-result result false)))

(defn safe-ok-result [result]
  (ok-result result true))

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
  (if (uuid? string)
    string
    (try
      (when (seq string)
        #?(:clj
           (java.util.UUID/fromString string)
           :cljs
           (uuid string)))
      (catch #?(:clj Exception :cljs :default) _ nil))))

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

(defn cell? [obj]
  #?(:clj (= clojure.lang.Ref (type obj))
     :cljs (= cljs.core/Atom (type obj))))

(defn call-and-set [cell f]
  #?(:clj (dosync
           (ref-set cell (f)))
     :cljs (reset! cell (f))))

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
  (mapv #(when % (f %)) xs))

(defn apply0 [f] (f))

(defn noop [])

#?(:cljs
   (do
     (def sys-env (atom {}))

     (defn setenv [k v]
       (swap! sys-env assoc k v))))

(defn getenv
  ([varname default]
   (let [val #?(:clj (or (System/getenv varname) default)
                :cljs (get @sys-env varname default))]
     (if-not (nil? val)
       val
       (throw-ex (str varname " - environment variable not set")))))
  ([varname]
   (getenv varname nil)))

(defn empty-string?
  "Return true if x is either nil or an empty string"
  [x]
  (let [s (if (string? x)
            (seq (string/trim x))
            x)]
    (or (nil? x) (nil? s))))

(def path-sep
  #?(:clj java.io.File/separator
     :cljs "/"))

(def line-sep
  #?(:clj (System/lineSeparator)
     :cljs "\n"))

(defn concat-lines [s & ss]
  (loop [ss ss, result s]
    (if-let [s (first ss)]
      (recur (rest ss) (str result line-sep s))
      result)))

(defn string-as-keyword [x]
  (if (string? x)
    (keyword x)
    x))

(defn keyword-as-string [x]
  (if (keyword? x)
    (subs (str x) 1)
    x))

(defn keyword-append [k x]
  (keyword (str (subs (str k) 1) x)))

(defn objects-as-string [xs]
  (mapv #(cond
           (and (seqable? %) (not (string? %)))
           (json/encode %)

           (or (keyword? %) (symbol? %))
           (str %)

           :else %)
        xs))

(def parse-string
  #?(:clj read-string
     :cljs cljs.reader/read-string))

(defn safe-close [obj]
  #?(:clj
     (try
       (.close obj)
       true
       (catch Exception ex
         false))
     :cljs true))

(defn pretty-spit
  [file-name edn]
  #?(:clj
     (spit file-name
           (with-out-str
             (pp/write edn :dispatch pp/code-dispatch)))
     :cljs edn))

(defn trace
  "Prints `msg` and `x`. Returns `x`."
  ([msg x]
   (println msg (pr-str x))
   x)
  ([x] (trace "" x)))

(defn trace-with-fn
  "Prints `msg`, `x` and the result of `(f x)`. Returns `x`."
  [msg f x]
  (println msg (pr-str x) (pr-str (f x)))
  x)

#?(:clj
   (do
     (defn exec-in-directory [path cmd]
       (let [^CommandLine cmd-line (CommandLine/parse cmd)
             ^Executor executor (DefaultExecutor.)]
         (.setWorkingDirectory executor (if (string? path) (File. path) path))
         (zero? (.execute executor cmd-line))))

     (defn read-env-var [x]
       (cond
         (symbol? x)
         (when-let [v (System/getenv (name x))]
           (let [s (try
                     (read-string v)
                     (catch Exception _e v))]
             (cond
               (not= (str s) v) v
               (symbol? s) (str s)
               :else s)))

         (vector? x)
         (first (filter identity (mapv read-env-var x)))

         :else x))

     (defn read-config-file [config-file]
       (let [f (io/file config-file)]
         (when-not (.exists f)
           (with-open [out (io/writer f)]
             (binding [*out* out]
               (print {:service {:port 8080}})))))
       (binding [*data-readers* {'$ read-env-var}]
         (read-string (slurp config-file))))))

(defn strs
  ([j ss] (string/join j ss))
  ([ss] (string/join "\n" ss)))

(defn call-with-cache
  "Similar to memoize, but only non-nil values are cached."
  [f]
  (let [mem (atom {})]
    (fn [& args]
      (if-let [e (find @mem args)]
        (val e)
        (let [ret (apply f args)]
          (when-not (nil? ret) (swap! mem assoc args ret))
          ret)))))
