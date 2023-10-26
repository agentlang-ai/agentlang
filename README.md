[![AppCI](https://github.com/fractl-io/fractl/actions/workflows/app.yml/badge.svg)](https://github.com/fractl-io/fractl/actions/workflows/app.yml)
[![Fractl clj CI](https://github.com/fractl-io/fractl/actions/workflows/fractl-clj.yml/badge.svg)](https://github.com/fractl-io/fractl/actions/workflows/fractl-clj.yml)
[![Fractl cljs CI](https://github.com/fractl-io/fractl/actions/workflows/fractl-cljs.yml/badge.svg)](https://github.com/fractl-io/fractl/actions/workflows/fractl-cljs.yml)

# The Fractl Programming Language

Fractl unlocks the future of tri-modal development - concurrent use of 3 different ways of programming:
* Traditional coding in IDEs,
* Visual development in a no-code builder, and,
* Code generation with generative-AI.

## Fractl Loves Gen AI
As a language, Fractl is a data-oriented and declarative, with an abstraction that is closer to natural language than traditional programming languages. This makes fractl a much better fit for Gen AI-powered code generation. 
Users can rapidly build business application in Fractl from high-level specifications - typically more than 10x faster than traditional programming languages.

## Fractl is open
The Fractl language specification, its compiler and runtime are open source.

The code you build in Fractl can be run anywhere using the open source compiler and runtime, thereby avoiding the vendor lock-in of other low-code/no-code platforms.

## Fractl is innovative
Fractl introduces a number of innovative concepts to programming:

1. **Graph-based Hierarchical Data Model** - compose the high-level data model of an application as hierarchical graph of business entities with relationships. Such [entities and relationships](https://docs.fractl.io/docs/concepts/data-model) are first-class constructs in Fractl.
2. **Zero-trust Programming** - tightly control operations on business entities through [declarative access-control](https://docs.fractl.io/docs/concepts/zero-trust-programming) encoded directly in the model itself.
3. **Declarative Dataflow** - express business logic as [purely-declarative patterns of data](https://docs.fractl.io/docs/concepts/declarative-dataflow).
4. **Resolvers** - use a simple, but [powerful interface](https://docs.fractl.io/docs/concepts/resolvers) to interface with external systems.
5. **Interceptors** - [extend the fractl runtime](https://docs.fractl.io/docs/concepts/interceptors) with custom capabilities.
6. **Entity-graph-Database Mapping** - take advantage of an [abstract persistence layer](https://docs.fractl.io/docs/concepts/entity-db-mapping) for fully-automated storage of entity instances.

## A Taste of Fractl

The following code snippet shows the Fractl model (i.e., program) for a simple accounting application. 

```clojure
(component :Accounts.Core)

(entity :Company
 {:Name {:type :String :guid true}
  :rbac [{:roles ["manager"] :allow [:create]}]})

(entity :AccountHead
 {:Name {:type :String :id true}
  :rbac [{:roles ["accountant"] :allow [:create]}]})

(entity :Entry
 {:No {:type :Int :id true}
  :Type {:oneof ["income" "expense"]}
  :Amount :Decimal
  :Remarks {:type :String :optional true}
  :DateCreated :Now})

(relationship :CompanyAccounts
 {:meta {:contains [:Company :AccountHead]}})

(relationship :Transactions
 {:meta {:contains [:AccountHead :Entry]}})

(record :BalanceReport
 {:Balance :Decimal
  :GeneratedOn :Now})

(defn- find-balance [entries]
  (reduce (fn [b t]
            (let [op (if (= "income" (:Type t)) + -)]
              (op b (:Amount t))))
          0 entries))

(event :GenerateReport
 {:Since :DateTime
  :Company :String
  :AccountHead :String})

(dataflow :GenerateReport
 {:AccountHead? {}
  :-> [[:CompanyAccounts?
        {:Company {:Name? :GenerateReport.Company}}
        :GenerateReport.AccountHead]]
  :as [:A]}
 {:Entry
  {:DateCreated? [:>= :GenerateReport.Since]}
  :-> [[:Transactions? :A]]
  :as :Es}
 {:BalanceReport
  {:Balance '(find-balance :Es)}})
```

Save this code to a file named `accounts.fractl` and its ready to be run as a highly-scalable accounting service with RESTful APIs to perform CRUD operations and generate balance report!
But before you can actually run it, you need to install Fractl. The next section will help you with that.

## Download and Install

#### Prerequisites

1. JVM 19 or later
2. Linux, Mac OSX or a Unix emulator in Windows

Download the [Fractl CLI tool](https://raw.githubusercontent.com/fractl-io/fractl-releases/87fe3632fca9cf1e9bdd4b2655ed89fed345d6ae/fractl) and execute the model:

```shell
./fractl /path/to/accounts.fractl
```

We can create a new company using an `HTTP POST` request,

```shell
curl --header "Content-Type: application/json" \
--request POST \
--data '{"Accounts.Core/Company": {"Name": "acme"}}' \
http://localhost:8080/_e/Accounts.Core/Company
```

To make sure the new company is persisted in the store, try the following `HTTP GET`:

```shell
curl http://localhost:8080/_e/Accounts.Core/Company/acme
```

If Fractl is installed correctly, both these requests will return an `OK` status along with a `:Company` instance.
You're all set to further explore **Fractl**. Please proceed to the official [documentation](https://docs.fractl.io/docs) pages.
