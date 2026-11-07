"""AI Visual QA: OCR + spelling checks on visible text in review media.

`engines` reads text, `spelling` decides what looks wrong, `pipeline` runs a stored
`AIReview` end to end, and `service` is what the API calls (start, decide, comment).
"""

PIPELINE_VERSION = '1.0'
TOPIC = 'ai_visual_qa.run'
