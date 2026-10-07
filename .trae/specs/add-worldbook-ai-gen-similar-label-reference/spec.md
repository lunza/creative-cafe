# World Book AI Generation Similar Label Reference Spec

## Why
Currently, labels in the World Book have limited practical application. By implementing a mechanism that references entries with similar labels during AI generation, the system can provide the AI with concrete examples of existing styles, settings, and information, significantly enhancing the relevance and consistency of new entries.

## What Changes
Introduce a three-stage pipeline for AI-generated World Book entries:
- **Stage 1: Label Requirement Identification**: Analyze existing label distribution to determine the target entry type and identify labels that should be used for reference.
- **Stage 2: Reference Content Collection**: Retrieve the full content of existing entries associated with the identified reference labels.
- **Stage 3: Enhanced Generation**: Use the retrieved reference content and the overall world theme as context to generate the final entry.

## Impact
- **Affected specs**: World Book AI Generation pipeline.
- **Affected code**: AI request handlers for World Book, entry retrieval logic, and prompt construction modules.

## ADDED Requirements

### Requirement: Similar Label Reference Pipeline
The system SHALL implement a multi-stage process when a user triggers AI generation for a World Book entry.

#### Scenario: Successful Enhanced Generation
- **WHEN** a user initiates AI generation for a new World Book entry.
- **THEN** the system shall:
    1. **Identify Labels**: Extract all existing entries and labels, send them with the request to the AI to determine the entry type and a list of reference labels.
    2. **Collect Content**: Fetch all audited entries linked to those reference labels and extract their full fields.
    3. **Generate with Context**: Send the original request, the extracted reference entry content, and the world theme to the AI for final generation.
    4. **Produce Result**: Deliver an entry that maintains high consistency with the existing world setting and style.

### Requirement: Quality and Performance
- The reference data MUST only include audited/verified content.
- The pipeline MUST NOT significantly increase the total response time for the user.
- The final output MUST exhibit clear continuity with the reference entries.
