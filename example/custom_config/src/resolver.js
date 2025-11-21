import { fetchConfig } from "../../../out/runtime/api.js"

export async function createChatMessage(_, inst) {
    const config = await fetchConfig('chat.core/Config')
    console.log(`Connecting to chat server ${config.server} using key ${config.key}`)
    const to = inst.lookup('to'); const message = inst.lookup('message')
    console.log(`To: ${to}, Body: ${message}`)
    return inst
}