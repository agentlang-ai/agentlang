// Usage: importModule("./mymodels/acme.js")
export async function importModule(s: string) {
    let m = await import(s);
    // e.g of dynamic fn-call:
    //// let f = eval("(a, b) => m.add(a, b)");
    //// console.log(f(10, 20))
    return m;
}