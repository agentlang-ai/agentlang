(ns fractl.test.rbac
  (:require #?(:clj  [clojure.test :refer [deftest is]]
               :cljs [cljs.test :refer-macros [deftest is]])
            [clojure.string :as s]
            [fractl.component :as cn]
            [fractl.evaluator :as ev]
            [fractl.auth]
            [fractl.rbac.core :as rbac]
            [fractl.lang.internal :as li]
            [fractl.lang
             :refer [component attribute event
                     entity record relationship dataflow]]
            #?(:clj  [fractl.test.util :as tu :refer [defcomponent]]
               :cljs [fractl.test.util :as tu :refer-macros [defcomponent]])))

(deftest role-management
  (defcomponent :RoleMgmt
    (dataflow
     :RoleMgmt/CreateUsers
     {:Fractl.Kernel.Identity/User {:Email "abc@abc.com"}}
     {:Fractl.Kernel.Identity/User {:Email "xyz@xyz.com"}})
    (dataflow
     :RoleMgmt/CreateRoles
     {:Fractl.Kernel.Rbac/Role {:Name "r1"}}
     {:Fractl.Kernel.Rbac/Role {:Name "r2"}})
    (dataflow
     :RoleMgmt/AssignPrivileges
     {:Fractl.Kernel.Rbac/Privilege
      {:Name "p1"
       :Actions [:q# [:read :create :update]]
       :Resource [:q# [:A :B]]}}
     {:Fractl.Kernel.Rbac/Privilege
      {:Name "p2"
       :Actions [:q# [:read]]
       :Resource [:q# [:C]]}}
     {:Fractl.Kernel.Rbac/PrivilegeAssignment
      {:Role "r1" :Privilege "p1"}}
     {:Fractl.Kernel.Rbac/PrivilegeAssignment
      {:Role "r1" :Privilege "p2"}}
     {:Fractl.Kernel.Rbac/PrivilegeAssignment
      {:Role "r2" :Privilege "p2"}})
    (dataflow
     :RoleMgmt/AssignRoles
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "r1" :Assignee "abc@abc.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "r2" :Assignee "xyz@xyz.com"}}))
  (let [[r1 r2 r3 r4]
        (mapv tu/result [:RoleMgmt/CreateUsers :RoleMgmt/CreateRoles
                         :RoleMgmt/AssignPrivileges :RoleMgmt/AssignRoles])]
    (is (cn/instance-of? :Fractl.Kernel.Identity/User (first r1)))
    (is (cn/instance-of? :Fractl.Kernel.Rbac/Role (first r2)))
    (is (cn/instance-of? :Fractl.Kernel.Rbac/PrivilegeAssignment (first r3)))
    (is (cn/instance-of? :Fractl.Kernel.Rbac/RoleAssignment (first r4)))
    (let [ps1 (rbac/privileges "abc@abc.com")
          ps2 (rbac/privileges "xyz@xyz.com")
          p2 (first ps2)]
      (is (= (count ps1) 2))
      (is (= (count ps2) 1))
      (is (= [:read] (:Actions p2)))
      (is (= [:C] (:Resource p2))))))

(def ^:private call-with-rbac tu/call-with-rbac)
(def ^:private finalize-events tu/finalize-events)
(def ^:private reset-events! tu/reset-events!)
(def ^:private with-user tu/with-user)

(deftest basic-rbac-dsl
  (reset-events!)
  (defcomponent :Brd
    (entity
     :Brd/E
     {:rbac [{:roles ["brd-user"] :allow [:create]}
             {:roles ["brd-manager"] :allow [:create :update :read]}]
      :meta {li/owner-exclusive-crud false}
      :Id {:type :Int :identity true}
      :X :Int})
    (dataflow
     :Brd/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@brd.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@brd.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u3@brd.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "brd-user" :Assignee "u2@brd.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "brd-manager" :Assignee "u1@brd.com"}}))
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:Brd/InitUsers {}})))
  (let [e? (partial cn/instance-of? :Brd/E)]
    (call-with-rbac
     (fn []
       (let [create-e (fn [id]
                        {:Brd/Create_E
                         {:Instance
                          {:Brd/E {:Id id :X (* id 100)}}}})
             update-e (fn [id]
                        {:Brd/Update_E
                         {:Id id :Data {:X (* id 200)}}})
             lookup-e (fn [id]
                        {:Brd/Lookup_E {:Id id}})
             delete-e (fn [id] {:Brd/Delete_E {:Id id}})
             test-lookup (fn [user factor err e]
                           (if err
                             (let [r (tu/eval-all-dataflows (with-user user (lookup-e e)))]
                               (or (tu/not-found? r) (tu/is-error #(identity r))))
                             (let [r (tu/first-result (with-user user (lookup-e e)))]
                               (is (e? r)) (is (= (:Id r) e)) (is (= (:X r) (* factor e))))))]
         (tu/is-error #(tu/eval-all-dataflows (create-e 1)))
         (is (e? (tu/first-result (with-user "u1@brd.com" (create-e 1)))))
         (is (e? (tu/first-result (with-user "u2@brd.com" (create-e 2)))))
         (tu/is-error #(tu/eval-all-dataflows (with-user "u3@brd.com" (create-e 3))))
         (let [t1 (partial test-lookup "u1@brd.com" 100 false)
               t2 (partial test-lookup "u2@brd.com" 100)
               t3 (partial test-lookup "u3@brd.com" 100 true)]
           (t1 1)
           (t1 2)
           (t2 false 2)
           (t2 true 1)
           (test-lookup "u3@brd.com" 100 true 1)
           (t3 1)
           (t3 2))
         (let [test-update (fn [user err e]
                             (if err
                               (tu/is-error #(tu/eval-all-dataflows (with-user user (update-e e))))
                               (let [r (tu/first-result (with-user user (update-e e)))]
                                 (is (e? r))
                                 (is (= (:Id r) e))
                                 (is (= (:X r) (* e 200))))))
               t1 (partial test-update "u1@brd.com" false)
               t2 (partial test-update "u2@brd.com")
               t3 (partial test-update "u3@brd.com" true)]
           (t1 1)
           (t1 2)
           (test-lookup "u1@brd.com" 200 false 1)
           (test-lookup "u1@brd.com" 200 false 2)
           (t2 false 2)
           (test-lookup "u2@brd.com" 200 false 2)
           (t2 true 1)
           (t3 1)
           (t3 2)
           (tu/is-error #(tu/eval-all-dataflows (with-user "u2@brd.com" (delete-e 1))))
           (tu/is-error #(tu/eval-all-dataflows (with-user "u1@brd.com" (delete-e 2))))
           (test-lookup "u1@brd.com" 200 false 1)
           (test-lookup "u1@brd.com" 200 false 2)
           (let [r (tu/first-result (with-user "u2@brd.com" (delete-e 2)))]
             (is (e? r)) (is (= (:Id r) 2)))
           (test-lookup "u1@brd.com" 200 true 2)
           (test-lookup "u2@brd.com" 200 true 2)
           (let [r (tu/first-result (with-user "u1@brd.com" (delete-e 1)))]
             (is (e? r)) (is (= (:Id r) 1)))
           (test-lookup "u1@brd.com" 200 true 1)))))))

(deftest rbac-with-contains-relationship
  (reset-events!)
  (defcomponent :Wcr
    (entity
     :Wcr/E
     {:rbac [{:roles ["wcr-user"] :allow [:create :update :read]}]
      :Id {:type :Int :identity true}
      :X :Int})
    (entity
     :Wcr/F
     {:Id {:type :Int :identity true}
      :Y :Int})
    (relationship
     :Wcr/R
     {:meta {:contains [:Wcr/E :Wcr/F]}})
    (dataflow
     :Wcr/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@wcr.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@wcr.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "wcr-user" :Assignee "u1@wcr.com"}}))
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:Wcr/InitUsers {}})))
  (let [e? (partial cn/instance-of? :Wcr/E)]
    (call-with-rbac
     (fn []
       (let [fq (partial li/as-fully-qualified-path :Wcr)
             e? (partial cn/instance-of? :Wcr/E)
             f? (partial cn/instance-of? :Wcr/F)
             create-e (fn [id]
                        {:Wcr/Create_E
                         {:Instance
                          {:Wcr/E {:Id id :X (* id 100)}}}})
             delete-e (fn [id]
                        {:Wcr/Delete_E {:Id id}})
             create-f (fn [e id]
                        {:Wcr/Create_F
                         {:Instance
                          {:Wcr/F
                           {:Id id
                            :Y (* 5 id)}}
                          li/path-attr (str "/E/" e "/R")}})
             lookup-fs (fn [e]
                         {:Wcr/LookupAll_F
                          {li/path-attr (fq (str "path://E/" e "/R/F/%"))}})
             with-u1 (partial with-user "u1@wcr.com")
             e1 (tu/first-result (with-u1 (create-e 1)))
             [f1 f2 :as fs] (mapv #(tu/first-result (with-u1 (create-f 1 %))) [10 20])]
         (is (e? e1))
         (is (= 2 (count fs)))
         (is (every? f? fs))
         (is (every? (fn [f] (some #{"u1@wcr.com"} (cn/owners f))) fs))
         (is (tu/is-error #(tu/eval-all-dataflows (with-user "u2@wcr.com" (create-e 2)))))
         (let [fs (tu/result (with-u1 (lookup-fs 1)))]
           (is (= 2 (count fs)))
           (is (every? f? fs)))
         (is (e? (tu/first-result (with-u1 (delete-e 1)))))
         (is (tu/not-found? (tu/eval-all-dataflows (with-u1 (lookup-fs 1))))))))))

(deftest instance-privs
  (reset-events!)
  (defcomponent :Ipv
    (entity
     :Ipv/E
     {:rbac [{:roles ["ipv-user"] :allow [:create :update :read]}
             {:roles ["ipv-guest"] :allow [:read]}]
      :Id {:type :Int :identity true}
      :X :Int})
    (dataflow
     :Ipv/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@ipv.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@ipv.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "ipv-user" :Assignee "u1@ipv.com"}})
    {:Fractl.Kernel.Rbac/RoleAssignment
     {:Role "ipv-guest" :Assignee "u2@ipv.com"}})
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:Ipv/InitUsers {}})))
  (call-with-rbac
   (fn []
     (let [e? (partial cn/instance-of? :Ipv/E)
           create-e (fn [user id]
                      (tu/first-result
                       (with-user
                         user
                         {:Ipv/Create_E
                          {:Instance
                           {:Ipv/E {:Id id :X (* id 100)}}}})))
           update-e (fn [user id x]
                      (tu/first-result
                       (with-user
                         user
                         {:Ipv/Update_E
                          {:Id id
                           :Data {:X x}}})))
           lookup-e (fn [user id]
                      (tu/first-result
                       (with-user
                         user
                         {:Ipv/Lookup_E
                          {:Id id}})))
           inst-priv (fn [owner assignee actions id]
                       (tu/first-result
                        (with-user
                          owner
                          {:Fractl.Kernel.Rbac/Create_InstancePrivilegeAssignment
                           {:Instance
                            {:Fractl.Kernel.Rbac/InstancePrivilegeAssignment
                             {:Resource :Ipv/E
                              :ResourceId id
                              :Assignee assignee
                              :Actions actions}}}})))
           del-inst-priv (fn [owner assignee id] (inst-priv owner assignee nil id))
           ip? (partial cn/instance-of? :Fractl.Kernel.Rbac/InstancePrivilegeAssignment)
           e1 (create-e "u1@ipv.com" 1)]
       (is (e? e1))
       (is (not (create-e "u2@ipv.com" 2)))
       (is (cn/same-instance? e1 (lookup-e "u1@ipv.com" 1)))
       (is (not (lookup-e "u2@ipv.com" 1)))
       (is (e? (update-e "u1@ipv.com" 1 3000)))
       (is (not (update-e "u2@ipv.com" 1 5000)))
       (is (ip? (inst-priv "u1@ipv.com" "u2@ipv.com" [:read :update] 1)))
       (let [e (lookup-e "u1@ipv.com" 1)]
         (is (= 3000 (:X e)))
         (is (= [:read :update] (cn/instance-privileges-for-user e "u2@ipv.com")))
         (is (cn/same-instance? e (lookup-e "u2@ipv.com" 1)))
         (is (e? (update-e "u2@ipv.com" 1 5000)))
         (is (ip? (del-inst-priv "u1@ipv.com" "u2@ipv.com" 1)))
         (let [e (lookup-e "u1@ipv.com" 1)]
           (is (= 5000 (:X e)))
           (is (not (cn/instance-privileges-for-user e "u2@ipv.com")))
           (is (not (update-e "u2@ipv.com" 1 8000)))
           (is (not (lookup-e "u2@ipv.com" 1)))
           (is (cn/same-instance? e (lookup-e "u1@ipv.com" 1)))))))))

(deftest creator-and-parent-as-owners
  (reset-events!)
  (defcomponent :I1018
    (entity
     :I1018/A
     {:rbac [{:roles ["i1018-admin"] :allow [:create :update :read]}]
      :Id {:type :Int :identity true}
      :X :Int})
    (entity
     :I1018/B
     {:rbac [{:roles ["i1018-user"] :allow [:create :update :read]}]
      :Id {:type :Int :identity true}
      :Y :Int})
    (relationship
     :I1018/R
     {:meta {:contains [:I1018/A :I1018/B]}})
    (dataflow
     :I1018/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@i1018.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@i1018.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1018-admin" :Assignee "u1@i1018.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1018-user" :Assignee "u2@i1018.com"}}))
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:I1018/InitUsers {}})))
  (call-with-rbac
   (fn []
     (let [fq (partial li/as-fully-qualified-path :I1018)
           a? (partial cn/instance-of? :I1018/A)
           b? (partial cn/instance-of? :I1018/B)
           create-a (fn [id]
                      {:I1018/Create_A
                       {:Instance
                        {:I1018/A {:Id id :X (* id 100)}}}})
           create-b (fn [a id]
                      {:I1018/Create_B
                       {:Instance
                        {:I1018/B
                         {:Id id
                          :Y (* 5 id)}}
                        li/path-attr (str "/A/" a "/R")}})
           lookup-bs (fn [a]
                       {:I1018/LookupAll_B
                        {li/path-attr (fq (str "path://A/" a "/R/B/%"))}})
           with-u1 (partial with-user "u1@i1018.com")
           with-u2 (partial with-user "u2@i1018.com")
           a1 (tu/first-result (with-u1 (create-a 1)))
           bs1 (mapv #(tu/first-result (with-u2 (create-b 1 %))) [10 20])
           bs2 (tu/result (with-u2 (lookup-bs 1)))
           is-bs (fn [bs]
                   (is (= (count bs) 2))
                   (is (every? b? bs))
                   (is (every? #(= #{"u1@i1018.com" "u2@i1018.com"}
                                   (cn/owners %)) bs)))]
       (is (a? a1))
       (is-bs bs1)
       (is-bs bs2)))))

(deftest issue-1025-rbac-update
  (reset-events!)
  (defcomponent :I1025
    (entity
     :I1025/Member
     {:Id :Identity
      :rbac [{:roles ["i1025"] :allow [:create]}]})
    (entity :I1025/Assessment {:Id :Identity})
    (relationship
     :I1025/AssessmentOf
     {:meta {:contains [:I1025/Member :I1025/Assessment]}})
    (relationship
     :I1025/AssessementBy
     {:meta {:between [:I1025/Member :I1025/Assessment]}})
    (relationship
     :I1025/Relation
     {:meta {:between [:I1025/Member :I1025/Member :as [:From :To]]}
      :rbac {:owner :From}})
    (dataflow
     :I1025/CreateAssessment
     {:I1025/Assessment {}
      :-> [[:I1025/AssessmentOf {:I1025/Member {:Id? :I1025/CreateAssessment.Of}}]
           [{:I1025/AssessementBy {}} {:I1025/Member {:Id? :I1025/CreateAssessment.By}}]]})
    (dataflow
     :I1025/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@i1025.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@i1025.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1025" :Assignee "u1@i1025.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1025" :Assignee "u2@i1025.com"}}))
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:I1025/InitUsers {}})))
  (call-with-rbac
   (fn []
     (let [wu1 (partial with-user "u1@i1025.com")
           wu2 (partial with-user "u2@i1025.com")
           create-member (fn [with-user]
                           (tu/first-result
                            (with-user {:I1025/Create_Member
                                        {:Instance
                                         {:I1025/Member {}}}})))
           create-relation (fn [with-user from to]
                             (tu/first-result
                              (with-user {:I1025/Create_Relation
                                          {:Instance
                                           {:I1025/Relation
                                            {:From from :To to}}}})))
           create-assessment (fn [with-user of by]
                               (tu/first-result
                                (with-user {:I1025/CreateAssessment
                                            {:Of of :By by}})))
           assign-ownership (fn [with-user id]
                              (tu/first-result
                               (with-user {:Fractl.Kernel.Rbac/Create_OwnershipAssignment
                                           {:Instance
                                            {:Fractl.Kernel.Rbac/OwnershipAssignment
                                             {:Resource :I1025/Member
                                              :ResourceId id
                                              :Assignee "u2@i1025.com"}}}})))
           remove-ownership (fn [with-user id]
                              (tu/first-result
                               (with-user {:Fractl.Kernel.Rbac/Delete_OwnershipAssignment
                                           {li/id-attr id}})))
           m? (partial cn/instance-of? :I1025/Member)
           a? (partial cn/instance-of? :I1025/Assessment)
           r? (partial cn/instance-of? :I1025/Relation)
           m1 (create-member wu1), m2 (create-member wu1)
           m3 (create-member wu2)]
       (is (m? m1)) (is (m? m2)) (is (m? m3))
       (is (r? (create-relation wu1 (:Id m1) (:Id m2))))
       (is (r? (create-relation wu1 (:Id m1) (:Id m3))))
       (is (not (create-relation wu2 (:Id m1) (:Id m2))))
       (is (r? (create-relation wu2 (:Id m3) (:Id m1))))
       (is (a? (create-assessment wu1 (:Id m1) (:Id m1))))
       (is (a? (create-assessment wu1 (:Id m1) (:Id m2))))
       (is (tu/is-error #(create-assessment wu2 (:Id m1) (:Id m2))))
       (let [res (mapv (partial assign-ownership wu1) [(:Id m1) (:Id m2)])
             oa? (partial cn/instance-of? :Fractl.Kernel.Rbac/OwnershipAssignment)]
         (is (every? oa? res))
         (is (a? (create-assessment wu2 (:Id m1) (:Id m2))))
         (is (every? oa? (mapv (partial remove-ownership wu1) (mapv li/id-attr res))))
         (is (tu/is-error #(create-assessment wu2 (:Id m1) (:Id m2)))))))))

(deftest issue-1035-owner-assign
  (defcomponent :I1035
    (entity :I1035/Member {:Id :Identity
                           :rbac [{:roles ["i1035"] :allow [:create]}]})
    (entity :I1035/Score {:Id :Identity
                          :rbac [{:roles ["i1035"] :allow [:create]}]})
    (relationship
     :I1035/Relation
     {:meta {:between [:I1035/Member :I1035/Member :as [:From :To]]}
      :rbac {:owner :From
             :assign {:ownership [:To :-> :From]}}})
    (relationship
     :I1035/ScoreFor
     {:meta {:contains [:I1035/Member :I1035/Score]}})
    (dataflow
     :I1035/AssignScore
     {:I1035/Score {}
      :-> [[:I1035/ScoreFor {:I1035/Member {:Id? :I1035/AssignScore.Member}}]]})
    (dataflow
     :I1035/InitUsers
     {:Fractl.Kernel.Identity/User
      {:Email "u1@i1035.com"}}
     {:Fractl.Kernel.Identity/User
      {:Email "u2@i1035.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1035" :Assignee "u1@i1035.com"}}
     {:Fractl.Kernel.Rbac/RoleAssignment
      {:Role "i1035" :Assignee "u2@i1035.com"}}))
  (is (finalize-events))
  (is (cn/instance-of?
       :Fractl.Kernel.Rbac/RoleAssignment
       (tu/first-result {:I1035/InitUsers {}})))
  (call-with-rbac
   (fn []
     (let [wu1 (partial with-user "u1@i1035.com")
           wu2 (partial with-user "u2@i1035.com")
           create-member (fn [with-user]
                           (tu/first-result
                            (with-user {:I1035/Create_Member
                                        {:Instance
                                         {:I1035/Member {}}}})))
           lookup-owners (fn [with-user member-id]
                           (cn/owners
                            (tu/first-result
                             (with-user
                               {:I1035/Lookup_Member {:Id member-id}}))))
           assign-score (fn [with-user member-id]
                          (tu/first-result
                           (with-user {:I1035/AssignScore
                                       {:Member member-id}})))
           create-relation (fn [with-user from to]
                             (tu/first-result
                              (with-user {:I1035/Create_Relation
                                          {:Instance
                                           {:I1035/Relation
                                            {:From from :To to}}}})))
           delete-relation (fn [with-user relid]
                             (tu/first-result
                              (with-user {:I1035/Delete_Relation
                                          {li/id-attr relid}})))
           m? (partial cn/instance-of? :I1035/Member)
           s? (partial cn/instance-of? :I1035/Score)
           r? (partial cn/instance-of? :I1035/Relation)
           m1 (create-member wu1) m2 (create-member wu1)
           m3 (create-member wu2)]
       (is (every? m? [m1 m2 m3]))
       (is (= #{"u1@i1035.com"} (lookup-owners wu1 (:Id m1))))
       (is (= #{"u1@i1035.com"} (lookup-owners wu1 (:Id m2))))
       (is (= #{"u2@i1035.com"} (lookup-owners wu2 (:Id m3))))
       (is (s? (assign-score wu1 (:Id m1))))
       (is (not (assign-score wu2 (:Id m2))))
       (is (s? (assign-score wu2 (:Id m3))))
       (is (not (create-relation wu2 (:Id m1) (:Id m3))))
       (is (r? (create-relation wu1 (:Id m1) (:Id m2))))
       (is (not (assign-score wu2 (:Id m2))))
       ;; assing ownership via Relation.
       (let [r (create-relation wu1 (:Id m2) (:Id m3))]
         (is (r? r))
         (is (= #{"u1@i1035.com"} (lookup-owners wu1 (:Id m1))))
         (is (= #{"u1@i1035.com" "u2@i1035.com"} (lookup-owners wu1 (:Id m2))))
         (is (= #{"u2@i1035.com"} (lookup-owners wu2 (:Id m3))))
         (is (s? (assign-score wu2 (:Id m2))))
         ;; revoke ownership by deleting Relation.
         (is (cn/same-instance? r (delete-relation wu1 (li/id-attr r))))
         (is (= #{"u1@i1035.com"} (lookup-owners wu1 (:Id m1))))
         (is (= #{"u1@i1035.com"} (lookup-owners wu1 (:Id m2))))
         (is (= #{"u2@i1035.com"} (lookup-owners wu2 (:Id m3)))))))))
