// Click, conversion, and timeline tracking
let clicks = [];
let conversions = [];
let timeline = [];

function trackClick(product, sessionId) {
  clicks.push({
    product,
    session_id: sessionId,
    time: Date.now()
  });
}

function trackConversion(sessionId, value) {
  conversions.push({
    session_id: sessionId,
    value,
    time: Date.now()
  });
}

function trackTimeline() {
  timeline.push({
    time: Date.now()
  });
}

function getClicks() {
  return clicks;
}

function getConversions() {
  return conversions;
}

function getTimeline() {
  return timeline;
}

module.exports = {
  trackClick,
  trackConversion,
  trackTimeline,
  getClicks,
  getConversions,
  getTimeline
};
