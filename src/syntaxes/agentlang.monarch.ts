// Monarch syntax highlighting for the agentlang language.
export default {
    keywords: [
        '@after','@async','@before','@enum','@expr','@meta','@oneof','@rbac','@ref','@upsert','@with_unique','agent','allow','and','as','await','between','catch','contains','create','delete','else','entity','error','event','extends','false','for','if','import','in','into','like','module','not','not_found','onSubscription','or','purge','query','read','record','relationship','resolver','roles','subscribe','true','update','upsert','where','workflow'
    ],
    operators: [
        '*','+',',','-','.','/',':',';','<','<=','<>','=','>','>=','?','@'
    ],
    symbols: /\(|\)|\*|\+|,|-|\.|\/|:|;|<|<=|<>|=|>|>=|\?|@|\[|\]|\{|\}/,

    tokenizer: {
        initial: [
            { regex: /(([_a-zA-Z][\w_]*)(\/([_a-zA-Z][\w_]*))?)/, action: { cases: { '@keywords': {"token":"keyword"}, '@default': {"token":"string"} }} },
            { regex: /[_a-zA-Z][\w_]*/, action: { cases: { '@keywords': {"token":"keyword"}, '@default': {"token":"string"} }} },
            { regex: /("(((\\([\s\S]))|((?!(((\\|")|\r)|\n))[\s\S]*?))|(\r?\n))*")/, action: {"token":"string"} },
            { regex: /-?[0-9]+/, action: {"token":"number"} },
            { include: '@whitespace' },
            { regex: /@symbols/, action: { cases: { '@operators': {"token":"operator"}, '@default': {"token":""} }} },
        ],
        whitespace: [
            { regex: /\s+/, action: {"token":"white"} },
            { regex: /\/\*/, action: {"token":"comment","next":"@comment"} },
            { regex: /\/\/[^\n\r]*/, action: {"token":"comment"} },
        ],
        comment: [
            { regex: /[^/\*]+/, action: {"token":"comment"} },
            { regex: /\*\//, action: {"token":"comment","next":"@pop"} },
            { regex: /[/\*]/, action: {"token":"comment"} },
        ],
    }
};
