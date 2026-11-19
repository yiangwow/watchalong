import { renderLanding } from './landing.js'
import { renderGate } from './room.js'

const room = /^\/r\/([A-Za-z0-9_-]{6,32})$/.exec(location.pathname)
if (room?.[1]) renderGate(room[1])
else renderLanding()
