const db = []

export function createInstance(ctx, inst) {
    db.push(inst)
    ctx.suspend()
    return inst
}

export function queryInstances() {
    return db
}