import {
  App,
  createApp,
  createVNode,
  ssrContextKey,
  ssrUtils,
  VNode
} from 'vue'
import { isPromise, isString } from '@vue/shared'
import { SSRContext, renderComponentVNode, SSRBuffer } from './render'

const { isVNode } = ssrUtils

async function unrollBuffer(buffer: SSRBuffer): Promise<string> {
  if (buffer.hasAsync) {
    let ret = ''
    for (let i = 0; i < buffer.length; i++) {
      let item = buffer[i]
      if (isPromise(item)) {
        item = await item
      }
      if (isString(item)) {
        ret += item
      } else {
        ret += await unrollBuffer(item)
      }
    }
    return ret
  } else {
    // sync buffer can be more efficiently unrolled without unnecessary await
    // ticks
    return unrollBufferSync(buffer)
  }
}

function unrollBufferSync(buffer: SSRBuffer): string {
  let ret = ''
  for (let i = 0; i < buffer.length; i++) {
    let item = buffer[i]
    if (isString(item)) {
      ret += item
    } else {
      // since this is a sync buffer, child buffers are never promises
      ret += unrollBufferSync(item as SSRBuffer)
    }
  }
  return ret
}

export async function renderToString(
  input: App | VNode,
  context: SSRContext = {}
): Promise<string> {
  if (isVNode(input)) {
    // raw vnode, wrap with app (for context)
    return renderToString(createApp({ render: () => input }), context)
  }

  // rendering an app
  const vnode = createVNode(input._component, input._props)
  vnode.appContext = input._context
  // provide the ssr context to the tree
  input.provide(ssrContextKey, context)
  const buffer = await renderComponentVNode(vnode)

  const result = await unrollBuffer(buffer as SSRBuffer)

  await resolveTeleports(context)

  if (context.__watcherHandles) {
    for (const unwatch of context.__watcherHandles) {
      unwatch()
    }
  }

  return result
}

export async function resolveTeleports(context: SSRContext) {
  if (context.__teleportBuffers) {
    context.teleports = context.teleports || {}
    for (const key in context.__teleportBuffers) {
      context.teleports[key] = await unrollBuffer(
        context.__teleportBuffers[key]
      )
    }
  }
}
