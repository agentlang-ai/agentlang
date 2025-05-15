import pkg from 'hello-world-npm';
const { helloWorld } = pkg;

export function add(a, b) {
    return a + b;
}

export function callHelloWorld() {
    return helloWorld()
}

export function sendMail(to, body) {
    console.log("To: " + to)
    console.log("Body: " + body)
    return `mail sent to ${to}`
}