{:name :Library
 :agentlang-version "current"
 :components [:Library.Identity
              :Library.Catalog
              :Library.Ledger]
 :config {:service {:port 8000}
          :store {:type :mem}}}
