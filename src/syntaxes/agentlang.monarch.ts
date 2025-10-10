// Monarch syntax highlighting for the agentlang language.
export default {
    keywords: [
        '@actions','@after','@as','@async','@before','@catch','@distinct','@enum','@expr','@from','@into','@meta','@oneof','@rbac','@ref','@then','@upsert','@with_unique','agent','ai','allow','and','await','between','case','commitTransaction','contains','create','decision','delete','directive','else','entity','error','event','extends','false','flow','for','glossary','if','import','in','like','meaning','module','name','not','not_found','onSubscription','or','purge','query','read','record','relationship','resolver','return','roles','rollbackTransaction','scenario','startTransaction','subscribe','synonyms','then','true','update','upsert','user','where','workflow'
    ],
    operators: [
        '!=','*','+',',','-','-->','.','/',':',';','<','<=','<>','=','==','>','>=','?','@'
    ],
    symbols: /!=|\(|\)|\*|\+|,|-|-->|\.|\/|:|;|<|<=|<>|=|==|>|>=|\?|@|\[|\]|\{|\}/,

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
