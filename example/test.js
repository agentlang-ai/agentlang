import pkg from 'hello-world-npm';
const { helloWorld } = pkg;

export function add(a, b) {
    return a + b;
}

export function callHelloWorld() {
    return helloWorld()
}