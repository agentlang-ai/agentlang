import { assert, describe, test } from 'vitest';
import { provider } from '../../src/runtime/agents/registry.js';
import {
  AgentServiceProvider,
  AIResponse,
  humanMessage,
  systemMessage,
} from '../../src/runtime/agents/provider.js';
import { doInternModule } from '../util.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import {
  Agent,
  fetchModule,
  Instance,
  isInstanceOfType,
  newInstanceAttributes,
} from '../../src/runtime/module.js';
import { WorkflowDefinition } from '../../src/language/generated/ast.js';
import { parseWorkflow } from '../../src/language/parser.js';
import { addWorkflowFromDef } from '../../src/runtime/loader.js';

describe('Agent API', () => {
  test('test01', async () => {
    await doInternModule('AAPI', `entity E {id Int @id}`);
    const m = fetchModule('AAPI');
    const ae01 = new Agent(
      'agent01',
      m.name,
      newInstanceAttributes().set('llm', 'llm01').set('tools', 'X, Y')
    );
    m.addAgent(ae01);
    const ae02 = new Agent('agent02', m.name, newInstanceAttributes().set('llm', 'llm02'));
    m.addAgent(ae02);
    let agentNames = m.getAgentNames();
    assert(agentNames.length == 2);
    assert(
      agentNames.find((n: string) => {
        return n == 'agent01';
      })
    );
    assert(
      agentNames.find((n: string) => {
        return n == 'agent02';
      })
    );
    m.removeAgent('agent01');
    agentNames = m.getAgentNames();
    assert(agentNames.length == 1);
    assert(agentNames[0] == 'agent02');
    const ae = m.getAgent('agent02');
    ae?.attributes.set('tools', 'A, B');
    const str = m.toString();
    assert(
      str ==
      `module AAPI

entity E
{
    id Int @id
}

agent agent02
{
    llm "llm02",
    tools "A, B"
}`
    );
  });
});

if (process.env.AL_TEST === 'true') {
  describe('Basic module operations', () => {
    test('test01 - OpenAI', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('Skipping OpenAI test - no API key');
        return;
      }
      const ai: AgentServiceProvider = new (provider('openai'))();
      await ai
        .invoke(
          [systemMessage('Is the following number odd? Answer YES or NO.'), humanMessage('11')],
          undefined
        )
        .then((result: AIResponse) => {
          assert(result.content == 'YES', `Expected YES, got ${result.content}`);
        });
    });

    test('test02 - Anthropic', async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Skipping Anthropic test - no API key');
        return;
      }
      const ai: AgentServiceProvider = new (provider('anthropic'))();
      await ai
        .invoke(
          [systemMessage('Is the following number odd? Answer YES or NO.'), humanMessage('11')],
          undefined
        )
        .then((result: AIResponse) => {
          assert(result.content == 'YES', `Expected YES, got ${result.content}`);
        });
    });
  });

  describe('Simple chat agent', () => {
    test('Agent should do text categorization', async () => {
      await doInternModule(
        'SimpleAIChat',
        `agent simpleChatAgent
          {instruction "Is the following number odd? Answer YES or NO."}
          workflow chat {
            {simpleChatAgent {message chat.N}}
          }
          `
      );
      assert(
        'NO' == (await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "12"}}`)),
        'Expected response was NO'
      );
      assert(
        'YES' == (await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "13"}}`)),
        'Expected response was YES'
      );
    });
  });

  describe('Simple planner agent', () => {
    test('Agent should generate and evaluate patterns', async () => {
      await doInternModule('SPA', `entity Person {id Int @id, name String, age Int}`);
      await doInternModule(
        'SimplePlannerAgent',
        `agent planner01
          {instruction "Based on the user request, create appropriate patterns based on the SPA module.",
           tools "SPA",
           runWorkflows false}
          workflow chat {{planner01 {message chat.msg}}}
          agent planner02
          {instruction "Create new instances of Person",
           tools "SPA/Person"}
          event planner02 {
            id Int,
            name String,
            age Int
           }
          `
      );
      const rr: Instance = await parseAndEvaluateStatement(`{SimplePlannerAgent/planner02 {id 10001, name "kk", age 20}}`);
      assert(isInstanceOfType(rr, 'SPA/Person'))
      assert(rr.lookup('id') == '10001')
      assert(rr.lookup('name') == 'kk')
      assert(rr.lookup('age') == 20)
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{SimplePlannerAgent/chat {msg "${ins}"}}`);
      };
      type P = { id: number; name: string; age: number };
      const cr = async (p: P) => {
        return await k(
          `Create a new Person aged ${p.age} with id ${p.id} and name '${p.name}'. Return only the pattern, no need to return a complete workflow.`
        );
      };
      const chk = (inst: Instance | Instance[], p: P) => {
        if (inst instanceof Array) {
          assert(inst.length == 1);
          inst = inst[0];
        }
        assert(isInstanceOfType(inst, 'SPA/Person'));
        assert(
          inst.lookup('id') == p.id && inst.lookup('age') == p.age && inst.lookup('name') == p.name
        );
      };
      const p1: P = { id: 101, name: 'Joe', age: 23 };
      chk(await cr(p1), p1);
      const p2: P = { id: 102, name: 'Mat', age: 34 };
      chk(await cr(p2), p2);
      let r: Instance[] = await k('Lookup person by id 101');
      assert(r.length == 1);
      chk(r[0], p1);
      const ins =
        'Generate a workflow for creating new Persons. All attributes must be receieved via the event. '
          .concat('The event should have an extra boolean attribute called X. ')
          .concat(
            'If X is set create the Person with age incremented by one, otherwise use the age as specified in the event. '
          )
          .concat(
            '(Only define the workflow, no need to define the event. Do not add additional quotes, etc to the workflow definition).'
          );
      const wfs: string = await k(ins);
      const wf: WorkflowDefinition = await parseWorkflow(wfs);
      addWorkflowFromDef(wf, 'SPA');
      let p = { id: 103, name: 'Chole', age: 11 };
      chk(
        await parseAndEvaluateStatement(`{SPA/${wf.name} {id 103, name "Chole", age 10, X true}}`),
        p
      );
      p = { id: 104, name: 'Dew', age: 10 };
      chk(
        await parseAndEvaluateStatement(`{SPA/${wf.name} {id 104, name "Dew", age 10, X false}}`),
        p
      );
      r = await k('Lookup person by id 104');
      assert(r.length == 1);
      chk(r[0], p);
    });
  });

  describe('Custom LLM provider', () => {
    test('test01', async () => {
      const apiKey = process.env['OPENAI_API_KEY'];
      await doInternModule(
        'CustomLLM',
        `{agentlang.ai/LLM {
            name "custom-test-llm",
            service "openai",
            config {"model": "gpt-4.1",
                    "maxTokens": 200,
                    "temperature": 0.7,
                    "apiKey": "${apiKey}",
                    "configuration": {
                      "baseURL": "https://api.openai.com/v1",
                      "defaultHeaders": {"Ocp-Apim-Subscription-Key": "xxxxy",
                                          "user": "admin"}
                     }
                    }
          }
        }

        entity Employee {
          id Int,
          name String
        }

        agent empAgent {
          llm "custom-test-llm",
          instruction "create a new employee",
          tools [CustomLLM/Employee]
        }
        `
      );
      const e = await parseAndEvaluateStatement(
        `{CustomLLM/empAgent {message "Employee id is 101 and name is Jacob"}}`
      );
      assert(isInstanceOfType(e, 'CustomLLM/Employee'));
      assert(e.lookup('id') == 101);
      assert(e.lookup('name') == 'Jacob');
    });
  });

  describe('Agent-flow', () => {
    test('test01', async () => {
      await doInternModule(
        'FlowTest',
        `entity Customer {
          email Email @id, name String, phone String
         }
         entity Product {
          id Int @id, name String, price Number
         }
         entity Failure {
          message String
         }
         decision classifyUserRequest {
          case ("request refers to customer") {
            Customer
          }

          case ("request refers to product") {
            Product
          }

          case ("request refers to employee, or anything other than customer or product") {
            Other
          }
        }
         agent createCustomer {
            instruction "Based on the user request, create a new customer.",
            tools "FlowTest/Customer"
         }
        agent createProduct {
            instruction "Based on the user request, create a product.",
            tools "FlowTest/Product"
         }
        event reportFailure {
          message String
        }
        workflow reportFailure {
          {Failure {message reportFailure.message}}
        }
        flow customerProductManager {
          classifyUserRequest --> "Product" createProduct
          classifyUserRequest --> "Customer" createCustomer
          classifyUserRequest --> "Other" reportFailure
        }
        agent customerProductManager
        {role "You are a product and customer manager"}
          `);
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{FlowTest/customerProductManager {message "${ins}"}}`);
      };
      await k('A new customer named Joseph K needs to be added. His email is jk@acme.com and phone number is 8989893')
      await k('Add a customer named Joe with email j@acme.com and phone 9674763')
      const custs: Instance[] = await parseAndEvaluateStatement(`{FlowTest/Customer? {}}`)
      assert(custs.length == 2)
      const emails = new Set<string>().add('jk@acme.com').add('j@acme.com')
      assert(custs.every((inst: Instance) => {
        return isInstanceOfType(inst, 'FlowTest/Customer') && emails.has(inst.lookup('email'))
      }))
      await k('A new product named X90 is added to the company. Its price is 789.22 and it should be assigned the id 1090')
      const prods: Instance[] = await parseAndEvaluateStatement(`{FlowTest/Product? {}}`)
      assert(prods.length == 1)
      assert(isInstanceOfType(prods[0], 'FlowTest/Product'))
      assert(prods[0].lookup('price') == 789.22)
      await k('Add an employee named Joe with email j@acme.com and phone 9674763') // reportFailure
      const fails: Instance[] = await parseAndEvaluateStatement(`{FlowTest/Failure? {}}`)
      assert(fails.length == 1)
      assert(isInstanceOfType(fails[0], 'FlowTest/Failure'))
    })
  })

  describe('Agent-guidance', () => {
    test('Apply scenarios and directives for agents', async () => {
      await doInternModule('GA', `entity Employee {id Int @id, name String, salary Number}`);
      await doInternModule(
        'GuidedAgent',
        `workflow scenario01 {
             {GA/Employee {name? "Jake"}} @as [employee];
             {GA/Employee {id? employee.id, salary employee.salary + employee.salary * 0.5}}
         }
         agent ga
          {instruction "Create appropriate patterns for managing Employee information",
           tools "GA",
           directives [{"if": "Employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"},
                       {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}],
           scenarios  [{"user": "Jake hit a jackpot!", "ai": "GuidedAgent/scenario01"}],
           glossary [{"name": "jackpot", "meaning": "sales of 5000 or above", "synonyms": "high sales, block-buster"}]}
         scenario ga.scn01 {
             if ("Kiran had a block-buster") { GuidedAgent/scenario01 }
         }
         directive GuidedAgent/ga.dir01 {
             if("sales is less than 2000") { "hike salary by 0.5 percent" }
         }
         workflow chat {{ga {message chat.msg}}}
          `
      );
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{GuidedAgent/chat {msg "${ins}"}}`);
      };
      let r = await k(
        `Create an Employee named Joe with id 102 and salary 2050`
      );
      assert(isInstanceOfType(r, 'GA/Employee'))
      r = await k(
        `Joe hit a jackpot`
      );
      assert(isInstanceOfType(r[0], 'GA/Employee'))
      assert(r[0].lookup('salary') == 2050 + 2050 * 0.5)
      r = await parseAndEvaluateStatement(`{GA/Employee {id? 102}}`)
      assert(isInstanceOfType(r[0], 'GA/Employee'))
      assert(r[0].lookup('salary') == 2050 + 2050 * 0.5)
    })
  })

  describe('Agent-schema', () => {
    test('Response schema support for agents', async () => {
      await doInternModule(
        'NetworkProvisioning',
        `record NetworkProvisioningRequest {
          type @enum("DNS", "WLAN"),
          requestedBy String,
          CNAME String,
          IPAddress String
        }

        event doProvisionDNS {
          CNAME String,
          IPAddress String
        }

        entity DNSEntry {
          provisioningId UUID @id @default(uuid()),
          CNAME String @indexed,
          IPAddress String
        }

        workflow doProvisionDNS {
          {DNSEntry {
            CNAME doProvisionDNS.CNAME,
            IPAddress doProvisionDNS.IPAddress
          }}
        }

        event doProvisionWLAN {
          IPAddress String @id
        }

        entity WLANEntry {
          provisioningId UUID @id @default(uuid()),
          IPAddress String
        }

        workflow doProvisionWLAN {
          {WLANEntry {
            IPAddress doProvisionWLAN.IPAddress
          }}
        }

        event reportRequestFailed {
          requestedBy String
        }

        entity ProvisioningFailure {
          requestedBy String
        }

        workflow reportRequestFailed {
          {ProvisioningFailure {
            requestedBy reportRequestFailed.requestedBy
          }}
        }

        event markRequestCompleted {
          type @enum("DNS", "WLAN"),
          provisioningId String,
          requestedBy String
        }

        entity requestCompletedNotification {
          type @enum("DNS", "WLAN"),
          provisioningId String,
          requestedBy String
        }

        workflow markRequestCompleted {
          {requestCompletedNotification {
            type markRequestCompleted.type,
            provisioningId markRequestCompleted.provisioningId,
            requestedBy markRequestCompleted.requestedBy
          }}
        }
        
        agent provisionDNS {
          instruction "Provision DNS with ipaddress={{classifyNetworkProvisioningRequest.IPAddress}} and cname={{classifyNetworkProvisioningRequest.CNAME}}",
          tools [NetworkProvisioning/doProvisionDNS],
          scratch [provisioningId]
        }

        agent provisionWLAN {
          instruction "Using {{classifyNetworkProvisioningRequest.IPAddress}} as ipaddress, provision WLAN",
          tools [NetworkProvisioning/doProvisionWLAN],
          scratch [provisioningId]
        }

        agent reportFailure {
          instruction "Report the request as failed for {{classifyNetworkProvisioningRequest.requestedBy}}."
          tools [NetworkProvisioning/reportRequestFailed]
        }
        
        agent classifyNetworkProvisioningRequest {
          instruction "Analyse the network provisioning request and return its type and other relevant information.",
          responseSchema NetworkProvisioningRequest
        }

        agent markTicketAsDone {
          instruction "Use type={{classifyNetworkProvisioningRequest.type}}, requestedBy={{classifyNetworkProvisioningRequest.requestedBy}} and provisioningId={{provisioningId}} to mark the request as completed",
          tools [NetworkProvisioning/markRequestCompleted]
        }
        
        flow networkProvisioningRequestManager {
          classifyNetworkProvisioningRequest --> "type is DNS" provisionDNS
          classifyNetworkProvisioningRequest --> "type is WLAN" provisionWLAN
          provisionDNS --> markTicketAsDone
          provisionWLAN --> markTicketAsDone
          classifyNetworkProvisioningRequest --> "type is Other" reportFailure
        }
        agent networkProvisioningRequestManager
        {role "You are a network-provisioning request manager"}
          `
      );
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{NetworkProvisioning/networkProvisioningRequestManager {message "${ins}"}}`);
      };
      await k(
        `User Jake needs a DNS for 192.3.4.5 for jake.blog.com`
      );
      const r1: Instance[] = await parseAndEvaluateStatement(`{NetworkProvisioning/DNSEntry? {}}`)
      assert(r1.length == 1)
      assert(isInstanceOfType(r1[0], 'NetworkProvisioning/DNSEntry'))
      assert(r1[0].lookup('CNAME') == 'jake.blog.com')
      assert(r1[0].lookup('IPAddress') == '192.3.4.5')
      const pid1 = r1[0].lookup('provisioningId')
      const r2: Instance[] = await parseAndEvaluateStatement(`{NetworkProvisioning/requestCompletedNotification {provisioningId? "${pid1}"}}`)
      assert(r2.length == 1)
      assert(isInstanceOfType(r2[0], 'NetworkProvisioning/requestCompletedNotification'))
      assert(r2[0].lookup('requestedBy').toLowerCase() == 'jake')

      await k(
        `WLAN request from Mat. IP 192.1.1.2`
      );
      const r3: Instance[] = await parseAndEvaluateStatement(`{NetworkProvisioning/WLANEntry? {}}`)
      assert(r3.length == 1)
      assert(isInstanceOfType(r3[0], 'NetworkProvisioning/WLANEntry'))
      assert(r3[0].lookup('IPAddress') == '192.1.1.2')
      const pid2 = r3[0].lookup('provisioningId')
      const r4: Instance[] = await parseAndEvaluateStatement(`{NetworkProvisioning/requestCompletedNotification {provisioningId? "${pid2}"}}`)
      assert(r4.length == 1)
      assert(isInstanceOfType(r4[0], 'NetworkProvisioning/requestCompletedNotification'))
      assert(r4[0].lookup('requestedBy').toLowerCase() == 'mat')
    })
  })

  describe('Agent-DecisionTable', () => {
    test('Decision tables in flows', async () => {
      await doInternModule(
        'CarCompany',
        `record BaseEV {
          bodyColor String,
          batteryPack @enum("59kwh", "79kwh"),
          charger @enum("11.2kw", "7.2kw")
        }

        entity EV extends BaseEV{
          id UUID @id @default(uuid()),
          segment @enum("economy", "luxury")
        }

        event orderEconomyEV extends BaseEV{
        }
        
        workflow orderEconomyEV {
          {EV {bodyColor orderEconomyEV.bodyColor,
              batteryPack orderEconomyEV.batteryPack,
              charger orderEconomyEV.charger,
              segment "economy"}}
        }

        event orderLuxuryEV extends BaseEV {
        }

        workflow orderLuxuryEV {
          {EV {bodyColor orderLuxuryEV.bodyColor,
              batteryPack orderLuxuryEV.batteryPack,
              charger orderLuxuryEV.charger,
              segment "luxury"}}
        }

        record BaseSUV {
          bodyColor String,
          transmission @enum("manual", "automatic"),
          fuel @enum("diesel", "petrol"),
          torque @enum("330nm", "380nm")
        }

        entity SUV extends BaseSUV {
          id UUID @id @default(uuid()),
          segment @enum("economy", "luxury")
        }
        
        event orderEconomySUV extends BaseSUV {
        }

        workflow orderEconomySUV {
          {SUV {bodyColor orderEconomySUV.bodyColor,
                transmission orderEconomySUV.transmission,
                fuel orderEconomySUV.fuel,
                torque orderEconomySUV.torque
                segment "economy"}}
        }
        
        event orderLuxurySUV extends BaseSUV {
        }

         workflow orderLuxurySUV {
          {SUV {bodyColor orderLuxurySUV.bodyColor,
                transmission orderLuxurySUV.transmission,
                fuel orderLuxurySUV.fuel,
                torque orderLuxurySUV.torque
                segment "luxury"}}
        }
        
        record CarOrderRequest {
          carType @enum("EV", "SUV"),
          bodyColor String,
          batteryPack String @optional,
          charger String @optional,
          transmission String @optional,
          fuel String @optional,
          torque String @optional,
          segment @enum("economy", "luxury")
        }
        
        agent analyseCarOrderRequest {
          instruction "Analyse the customer request for ordering a car and return the relevant information you are able to figure out",
          responseSchema CarOrderRequest
        }
        
        decision classifyOrder {
          case (carType == "EV" and segment == "economy") {
            EconomyEV
          }

          case (carType == "EV" and segment == "luxury") {
            LuxuryEV
          }

          case (carType == "SUV" and segment == "economy") {
            EconomySUV
          }

          case (carType == "SUV" and segment == "luxury") {
            LuxurySUV
          }
        }
        
        flow carOrderRequestManager {
          analyseCarOrderRequest --> classifyOrder
          classifyOrder --> "EconomyEV" orderEconomyEV
          classifyOrder --> "LuxuryEV" orderLuxuryEV
          classifyOrder --> "EconomySUV" orderEconomySUV
          classifyOrder --> "LuxurySUV" orderLuxurySUV
        }

        agent carOrderRequestManager {
          instruction "You are an agent who analyses customer order requests for new cars and make appropriate orders"
        }
        `)
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{CarCompany/carOrderRequestManager {message "${ins}"}}`);
      };
      await k(
        `I want an economic red EV with 59kwh battery pack and 7.2kw charger`
      );
      let rs: Instance[] = await parseAndEvaluateStatement(`{CarCompany/EV? {}}`)
      assert(rs.length == 1)
      assert(rs[0].lookup('bodyColor').toLowerCase() == 'red')
      assert(rs[0].lookup('batteryPack') == '59kwh')
      await k(
        `White diesel luxury SUV with manual transmission and 330nm torque`
      );
      rs = await parseAndEvaluateStatement(`{CarCompany/SUV? {}}`)
      assert(rs.length == 1)
      assert(rs[0].lookup('bodyColor').toLowerCase() == 'white')
      assert(rs[0].lookup('transmission') == 'manual')
      assert(rs[0].lookup('torque') == '330nm')
      assert(rs[0].lookup('segment') == 'luxury')
    })
  })
} else {
  describe('Skipping agent tests', () => {
    test('test01', async () => { });
  });
}
