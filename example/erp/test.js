import pkg from 'hello-world-npm'
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

export function validateSalary(amount) {
    return amount > 1000.0 && amount < 10000
}