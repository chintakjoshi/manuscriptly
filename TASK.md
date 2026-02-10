# Application Specification

## 1. Core Functionality

### Chat Bar (Left Side)

A conversational interface where users can input ideas and preferences about their blog. The agent will guide users with prompts and collect information.

### Dynamic Workspace (Right Side)

A workspace with individual agent artifacts or planning components.

#### Live Updates

The AI dynamically updates the blog in real time as the user interacts with the chat or the workspace. Server Sent Events can be used.

#### Brainstorming Workspace

This is the main workspace for planning with agent ideas for future blog posts.

## 2. Golden Flow

### Planner Workspace

Users interact with the planner to generate blog ideas. The agent researches topics and creates structured ideas.

### Individual Sessions

Users must be able to edit the generated plan manually before executing it. The agent should confirm changes and proceed to research and writing.

### Generated Content

Should be able to edit this manually as well. You can take liberties on how to display plan + content, doesn’t have to be tabs, but we need to be able to go back and access/read the plan after it’s  been executed. Think of the Cursor planning mode as an example.

## Core Deliverables

1.  A React based frontend application with a chat bar and workspace layout using Typescript.
2.  A Flask backend with endpoints for processing chat inputs, generating the blog, and handling live updates.
3.  A relational database such as PostgreSQL to store user preferences and generated content. Avoid using a separate vector database.
4.  Agentic infrastructure using the Anthropic or OpenAI agent SDK or responses API is preferred over frameworks like Langchain or Crew.

## 3. Checklist

### A. User Checklist

-   Chat experience: User should be able to chat back and forth and make changes to their blog.
-   Agent should ingest requirements and produce a content plan.
-   Include memory in the system prompt to avoid redundant questions.
-   Tool calls required:
    -   create_content_idea: Generate a plan from user request in main workspace.
    -   update_content_plan: Edit the specific plan from the individual session.
    -   execute_plan: Write full blog using the approved plan.
-   User must be able to edit or delete the plan manually.

### B. Technical Checklist

-   Frontend must be modular and built in React with Typescript.
-   Database must be relational.
-   Backend must use Flask and be modular.
-   Agent must store messages, call tools, and show live updates.
-   Core functionality must follow the golden flow.

### C. Above and Beyond

#### Pretty Good

-   Display calling tool state in chat when the agent is calling tools.

#### Getting Better

-   Store context about the user and company during signup so the AI does not ask basic questions.

#### Excellent

-   Implement web search capability for the agent.
-   Show message context tooltips explaining what context the AI used.
-   Implement a news scraper to find relevant topics.
