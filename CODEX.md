### Key Features

- **Chat Interface**: Conversational AI-driven interaction for content ideation
- **Dynamic Workspace**: Real-time updates showing brainstorming and planning components
- **Agentic Capabilities**: AI agent with tool-calling abilities for content creation
- **Session Management**: Individual sessions for focused content development
- **User Context Memory**: Personalized experience based on user and company information

## Tech Stack

### Frontend
- React 18+ with TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- Server-Sent Events (SSE) for live updates

### Backend
- FastAPI (Python web framework)
- SQLAlchemy/SQLModel (ORM)
- Alembic (database migrations)
- Pydantic (data validation)
- Anthropic SDK (AI integration)
- Swagger

### Database
- PostgreSQL (relational database)

### Additional Tools
- Uvicorn (ASGI server)
- Python virtual environment

## Development Phases

### Phase 1: Foundation Setup

#### Step 1: Project Structure & Environment
- Create project root with separate frontend and backend directories
- Set up Python virtual environment for backend
- Initialize Node.js project for frontend
- Create .env files for configuration (API keys, database URLs)
- Set up .gitignore for both frontend and backend

#### Step 2: Database Setup
- Install PostgreSQL locally
- Create development database
- Set up SQLAlchemy/SQLModel with database connection
- Configure Alembic for migrations
- Create initial migration structure (empty for now)

#### Step 3: Basic Backend Scaffold
- Install FastAPI, Uvicorn, SQLAlchemy, Pydantic
- Create main FastAPI application file
- Set up CORS middleware for local development
- Create basic health check endpoint
- Test server runs successfully

#### Step 4: Basic Frontend Scaffold
- Create React + TypeScript app with Vite
- Install Tailwind CSS and configure
- Create basic routing structure (single page for now)
- Set up API client utility for backend communication
- Test frontend connects to backend health check

---

### Phase 2: Core Data Models & API Foundation

#### Step 5: Database Schema Design
- Define User model (id, name, company context, created_at)
- Define Session model (id, user_id, name, created_at)
- Define Plan model (id, session_id, title, research_notes, status)
- Define Content model (id, plan_id, blog_content, created_at)
- Define Message model (id, session_id, role, content, tool_calls, created_at)
- Create and run Alembic migrations

#### Step 6: Basic CRUD Endpoints
- Create endpoints for sessions (create, list, get)
- Create endpoints for plans (create, get, update)
- Create endpoints for messages (create, list by session)
- Test all endpoints with sample data

---

### Phase 3: Chat Infrastructure

#### Step 7: SSE Setup for Live Updates
- Implement SSE endpoint in FastAPI for streaming responses
- Create connection manager for handling multiple client connections
- Set up frontend SSE client utility
- Test basic message streaming from backend to frontend

#### Step 8: Chat Message Storage
- Create service layer for storing chat messages
- Implement conversation history retrieval
- Build message formatting utilities (user vs assistant)
- Test full message persistence flow

---

### Phase 4: AI Agent Core

#### Step 9: Anthropic API Integration
- Set up Anthropic SDK in backend
- Create AI service wrapper for API calls
- Implement basic chat completion (no tools yet)
- Build system prompt for the content writing agent
- Include user context injection into system prompt

#### Step 10: Tool Definition & Registration
- Define Pydantic models for three tool schemas:
  - `create_content_idea`: Generate plan from user request
  - `update_content_plan`: Edit specific plan from individual session
  - `execute_plan`: Write full blog using approved plan
- Create tool registration system in backend
- Build tool execution router/handler
- Test tool schema validation

#### Step 11: Tool Execution Logic
- Implement create_content_idea handler (generates plan, saves to database)
- Implement update_content_plan handler (modifies existing plan)
- Implement execute_plan handler (generates blog content, saves to database)
- Add proper error handling for each tool

#### Step 12: Agentic Loop Implementation
- Build the main agent orchestration function
- Implement tool calling detection and execution
- Handle multi-turn tool use conversations
- Stream tool execution status via SSE
- Store tool calls and results in message history

---

### Phase 5: Frontend UI Components

#### Step 13: Chat Interface
- Build chat message list component
- Create message bubbles (user vs assistant styling)
- Build chat input component with send button
- Implement auto-scroll to latest message
- Add loading states during AI response

#### Step 14: Workspace/Planner Sidebar
- Create left sidebar layout component
- Build session list component
- Implement session creation UI
- Add session selection/switching functionality
- Style active session indicator

#### Step 15: Dynamic Workspace (Right Side)
- Build tabbed interface for Plan vs Content views
- Create plan card display component
- Build content display component
- Implement manual editing interface for plans
- Add delete functionality for plans

#### Step 16: Tool Calling State Display
- Create visual indicator component for "Agent is thinking..."
- Show which tool is being called in real-time
- Display tool execution progress
- Add success/failure feedback

---

### Phase 6: User Context & Memory

#### Step 17: User Context Storage
- Create simple onboarding/setup modal
- Build form for collecting user name and company info
- Store user context in database
- Inject context into agent system prompt automatically

#### Step 18: Agent Memory System
- Build context retrieval service
- Create "brain" that prevents redundant questions
- Implement context awareness in prompts
- Test agent doesn't re-ask known information

---

### Phase 7: Golden Flow Integration

#### Step 19: Planner Workspace Flow
- Implement complete flow from chat to plan creation
- Test brainstorming workspace updates in real-time
- Verify blog ideas display correctly
- Ensure "Start Session" buttons work

#### Step 20: Individual Session Flow
- Implement session-specific plan editing
- Build manual plan modification UI
- Add confirmation before plan execution
- Test research topic workflow

#### Step 21: Content Generation & Display
- Wire up execute_plan to content display
- Implement Plan vs Content tab switching
- Build content preview/editing interface
- Add ability to regenerate content

---

### Phase 8: Polish & Refinement

#### Step 22: Error Handling & Edge Cases
- Add comprehensive error handling throughout
- Implement retry logic for API failures
- Add user-friendly error messages
- Handle network disconnections gracefully

#### Step 23: UX Improvements
- Add loading skeletons
- Implement optimistic UI updates
- Add keyboard shortcuts (Enter to send, etc.)
- Improve mobile responsiveness

#### Step 24: Testing Core Functionality
- Test complete golden flow end-to-end
- Verify all three tools work correctly
- Test manual editing and deletion
- Ensure SSE updates work consistently

---

### Phase 9: Above & Beyond Features (Optional)

#### Step 25: Web Search Integration
- Integrate web search tool in agent
- Add search results to context
- Display search activity in UI
- Test research enhancement

#### Step 26: Message Context Tooltips
- Build tooltip/popover component
- Show what context influenced each response
- Display relevant user context used
- Add visual DNA indicators

#### Step 27: News Scraper
- Create background job for news scraping
- Build API endpoint for trending topics
- Store relevant articles in database
- Surface topics to agent

#### Step 28: Advanced UI Features
- Add markdown rendering for blog content
- Implement copy-to-clipboard functionality
- Build export capabilities (download as file)
- Add syntax highlighting for any code

---

### Phase 10: Final Integration & Testing

#### Step 29: End-to-End Testing
- Test complete user journey from onboarding to content generation
- Verify all database operations work correctly
- Test concurrent sessions
- Check SSE performance with multiple clients

#### Step 30: Documentation & Cleanup
- Document environment setup steps
- Create README with run instructions
- Clean up unused code
- Organize file structure for clarity

## User Experience Flow

### Golden Flow: Planner Workspace
1. User opens app and completes onboarding (name, company info)
2. User chats with agent about blog topic ideas
3. Agent uses `create_content_idea` tool to generate plan
4. Plan appears in dynamic workspace with blog idea cards
5. User clicks "Start Session" on a blog idea
6. Agent researches the topic and creates detailed plan

### Golden Flow: Individual Session
1. User can manually edit the plan before execution
2. User confirms and asks agent to execute
3. Agent uses `execute_plan` tool to generate full blog content
4. Content appears in workspace with Plan/Content tabs
5. User can edit, regenerate, or export the content

---

## Core Requirements Checklist

### User Requirements
- [ ] Chat back and forth interface
- [ ] Agent ingests requirements and produces content plan
- [ ] Agent has "brain/memory" to avoid redundant questions
- [ ] Three tool calls implemented (create_content_idea, update_content_plan, execute_plan)
- [ ] User can manually edit and delete plans

### Technical Requirements
- [ ] Modular React + TypeScript frontend
- [ ] Relational database (PostgreSQL) for data storage
- [ ] Modular Flask/FastAPI backend
- [ ] Message storage with tool call tracking
- [ ] Live updates via SSE
- [ ] Solid core functionality based on golden flow

### Above & Beyond Features
- [ ] Display tool calling state in chat
- [ ] User context storage to prevent silly questions
- [ ] Web search capability for research
- [ ] Message context tooltips showing AI reasoning
- [ ] News scraper for relevant topics

---

## Notes

- This is a **local development prototype only**
- No deployment to dev or production environments required
- Focus on core functionality and user experience over production-ready code
- Prioritize the golden flow scenarios for best results
- Above and beyond features should only be added if core functionality is solid
