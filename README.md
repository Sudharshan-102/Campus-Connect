# Campus Connect — DBMS Project using SurrealDB

## Project Details

- **Project Name:** Campus Connect
- **Database:** SurrealDB
- **Backend:** Node.js and Express.js
- **Frontend:** React.js
- **Team Number:** Team-15
- **Course / Subject:** Database Management Systems (DBMS)

## Team Members

Replace the placeholders below with every team member's roll number and full name.

| S. No. | Roll Number | Name           |
|---:|---|---|
| 1 | CB.SC.U4CSE25763 | SUDHARSHAN.K   |
| 2 | CB.SC.U4CSE25755 | SIVA VARDHAN.V |
| 3 | CB.SC.U4CSE25704 | AKILAN.T       |

## Project Overview

Campus Connect is a web application developed as a DBMS project to demonstrate the use of **SurrealDB** as the project's database. The application has a frontend, a backend, and a database layer. The frontend is used to interact with the application, the backend handles application requests, and SurrealDB stores and manages the application's data.


## Objectives

- Use SurrealDB as the database for a practical application.
- Connect the application backend to SurrealDB.
- Demonstrate database operations through the application and/or database queries.
- Show how data can be created, retrieved, updated, and deleted, where these operations are implemented.

## Technology Stack

- **SurrealDB:** Database used to store and query application data.
- **Node.js:** JavaScript runtime for the backend.
- **Express.js:** Backend framework for handling HTTP requests and API routes.
- **React.js**React for the frontend, with Vite as the development and build tool. 

## System Architecture

1. A user interacts with the frontend.
2. The frontend sends a request to the backend.
3. The backend processes the request and communicates with SurrealDB.
4. SurrealDB executes the relevant database operation.
5. The backend returns a response, which the frontend displays.

## CRUD Operations

Describe the operations that are actually implemented in your project. Add the real query/API details in `queries.txt`.

- **Create:** Adds a new record to the database.
- **Read:** Retrieves stored records from the database.
- **Update:** Modifies an existing record.
- **Delete:** Removes a record.
These operations are used in many places those are 

- **1.CRUD operations in Students.js**
- **2.CRUD operations in friendships.js**
- **3.CRUD operations in mentorship.js**
- **4.CRUD operations in collaborations.js**

## How to Run the Project

1. Start SurrealDB using the configuration required by the project.

Command : & "$env:LOCALAPPDATA\SurrealDB\surreal.exe" start --user root --pass secret memory

2. Start the backend using the project's server command.

Command : cd C:\Users\SUDHARSHAN\Downloads\campus-connect\campus-connect\server
npm run db:check
npm start

3. Start the frontend using the project's client command.

Command : 
cd C:\Users\SUDHARSHAN\Downloads\campus-connect\campus-connect\client
npm run dev

## Files Submitted

Place the required deliverables in the team folder:

- `presentation.pptx` — project presentation.
- `demo-video.mp4` — recording showing the project and query outputs.
- `queries.txt` — database queries used, with brief comments and outputs/screenshots where required.
- `README.md` — this project description and team member details.

## Demonstration Evidence

In the demo video, show:
1. The application running.
2. The relevant SurrealDB queries being executed.
3. The output/result for each query.
4. The application reflecting the result, where applicable.

Youtube Link: https://youtu.be/vuMtjHctJPM

## Conclusion

Campus Connect demonstrates how SurrealDB can be used as the database layer of a web application. The project connects application logic with database operations and provides a practical example of database-backed application development.


