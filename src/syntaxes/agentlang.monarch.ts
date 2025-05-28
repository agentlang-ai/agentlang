// Monarch syntax highlighting for the agentlang language.
export default {
    keywords: [
        '@rbac','allow','and','as','between','contains','create','delete','else','entity','error','event','extends','false','for','if','import','in','like','module','not_found','or','read','record','relationship','roles','throws','true','update','where','workflow'
    ],
    operators: [
        '*','+',',','-','.','/',':',';','<','<=','<>','=','>','>=','?','@'
    ],
    symbols: /\(|\)|\*|\+|,|-|\.|\/|:|;|<|<=|<>|=|>|>=|\?|@|\[|\]|\{|\}/,

    tokenizer: {
        initial: [
            { regex: /[_a-zA-Z][\w_]*/, action: { cases: { '@keywords': {"token":"keyword"}, '@default': {"token":"string"} }} },
            { regex: /(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/, action: {"token":"string"} },
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
