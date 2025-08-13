module timer

workflow e {
    console.log("hello")
}

workflow start {
    {agentlang/timer {
     name start.name, 
     duration 10, 
     unit "second", 
     trigger "timer/e"}}
}

workflow stop {
    delete {agentlang/timer {
            name? stop.name}}
}