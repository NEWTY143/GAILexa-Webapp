import { CopilotStudioClient } from '@microsoft/agents-copilotstudio-client'
import { Activity } from '@microsoft/agents-activity'
import { getConnectionSettings, acquireToken } from './auth.js'

/**
 * A thin wrapper around CopilotStudioClient that:
 *  - starts a conversation and captures the greeting
 *  - sends user messages and streams the agent's activities back
 */
export class GailexaSession {
  constructor() {
    this.client = null
    this.conversationId = null
  }

  async connect() {
    const token = await acquireToken()
    this.client = new CopilotStudioClient(getConnectionSettings(), token)
  }

  /**
   * Starts the conversation. Calls onActivity for each activity received
   * (greeting messages, typing indicators, etc.).
   */
  async start(onActivity) {
    if (!this.client) await this.connect()
    for await (const activity of this.client.startConversationStreaming(true)) {
      if (activity?.conversation?.id) {
        this.conversationId = activity.conversation.id
      }
      onActivity(activity)
    }
  }

  /**
   * Sends a text message and streams the agent's response activities.
   */
  async send(text, onActivity) {
    if (!this.client) await this.connect()
    const activity = Activity.fromObject({ type: 'message', text })
    for await (const reply of this.client.sendActivityStreaming(
      activity,
      this.conversationId ?? undefined
    )) {
      if (reply?.conversation?.id) {
        this.conversationId = reply.conversation.id
      }
      onActivity(reply)
    }
  }

  /**
   * Sends a message and returns the reply text WITHOUT surfacing it in the
   * chat UI. Used for behind-the-scenes requests like "summarize your
   * previous answer for voice playback".
   */
  async askHidden(text) {
    let out = ''
    await this.send(text, (activity) => {
      if (activity?.type === 'message' && activity.text) {
        out += (out ? '\n' : '') + activity.text
      }
    })
    return out.trim()
  }
}
