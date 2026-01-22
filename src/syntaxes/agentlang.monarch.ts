// Monarch syntax highlighting for the agentlang language.
export default {
    keywords: [
        '@actions','@after','@as','@asc','@async','@before','@catch','@desc','@distinct','@enum','@expr','@from','@full_join','@groupBy','@inner_join','@into','@join','@left_join','@meta','@oneof','@orderBy','@public','@rbac','@ref','@right_join','@then','@upsert','@where','@with_unique','agent','agentlang/retry','allow','and','attempts','await','backoff','between','case','commitTransaction','contains','create','decision','delete','directive','else','entity','error','event','extends','false','flow','for','glossaryEntry','if','import','in','like','module','not','not_found','onSubscription','or','purge','query','read','record','relationship','resolver','return','roles','rollbackTransaction','scenario','startTransaction','subscribe','throw','true','update','upsert','where','workflow'
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
            { regex: /(`(((\\([\s\S]))|((?!(((\\|`)|\r)|\n))[\s\S]*?))|(\r?\n))*`)/, action: {"token":"string"} },
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
