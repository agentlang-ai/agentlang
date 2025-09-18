module susp

import "resolver.js" @as r

entity E {
    id Int @id,
    x String
}

entity F {
    id Int @id
}
        
workflow EF {
    {E {id EF.id, x EF.x}} 
      @then {
        {F {id e.id * 10}}
      }
      @as e;
    e
}

resolver susp [susp/E] {
    create r.createInstance,
    query r.queryInstances
}