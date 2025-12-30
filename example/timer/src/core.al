module timer

workflow e {
    console.log("hello")
}

@public workflow start {
    {agentlang/timer {
     name start.name, 
     duration 2,
     unit "second", 
     trigger "timer/e"}}
}

@public workflow stop {
    delete {agentlang/timer {
            name? stop.name}}
}