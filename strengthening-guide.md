Here is a full-term vision for the application the way I see it:

Awareness

- Tourguide knows about the ins and outs of the codebase.
    - Top-down: It takes high level product understanding and knows which components of the code are responsible for it.
    - Bottom-up: this means knowing everything that is available in a codebase, regardless of if it is relevant or not
    - Tourguide should be able to build understanding in either direction, though top-down is first priority as that is where the real-world problem is most apparent
- Code components:
    - Frontend components involved in displaying feature
    - APIs that serve data for the feature
    - APIs that transform data for the feature
    - Databases that store data for the feature
    - Business logic and computation (at least at a blackbox level) that is done on the data

Learning:

- Tourguide's job is to teach. The initial inspiration for this came from go.dev/tour, but another good resource to analyze for teaching style is https://www.w3schools.com/html/ (or javascript or CSS on their website)
- This style of teaching is characterized in the following ways:
    - Small bits of information at a given time, never too much
        - go.dev presents fewer bits of information on a page than w3schools
        - But even then, w3schools will have the page divided into small bits via headers
        - The point remains that it's never too much information at once
        - This encourages users to flow through many concepts without interruption, which is the quickest way to build familiarity with a codebase and provide foundation for deeper understanding
    - Tough concepts are deferred to other documents
    - Tables are used to display information compactly
    - Interactivity is paramount:
        - go.dev will have a whole right half that is a code sandbox
        - w3schools will have examples ready to launch in a code sandbox
        - The example is meant to encourage trying different things or changing things to see what inputs result in what outputs (abstractly speaking)
    - The tutorial is not always comprehensive, but it points to comprehensive understanding
        - Usually via links to references
        - In our case, some links should go to source code (even better if in an editor, perhaps this can be configurable behavior)
- A lot of this learning is really just a repackaging of documentation
    - Documentation requires bottom-up awareness
    - Learning requires top-down awareness
    - The correct documentation presented in the correct sequence = tour/tutorial of the codebase

Interaction:

- Interacting with code is the first barrier that must be overcome to build understanding
    - This means being able to launch a local/dev copy of the product
- Otherwise, interaction depends on what kind of code component we're looking at
- Code reuse:
    - Ideally, the code has enough modularity to where tourguide itself can re-use the components to offer interactivity
    - User can easily use the components in a way they see fit, which requires zero source modification
    - We should support source modification at some point; we'd have to choose between modifying in original file system or building a copy of the source just for tourguide; I lean towards first one but we can reconsider when we get to implementing
- Interaction types:
    - Frontend:
        - We should be able to render components in the UI
        - Users should have a way to change input parameters
    - API:
        - Users should be able to make requests to the API
        - Users should be able to view outputs as well
    - Database:
        - Users should be able to view, create, modify data
        - Database should be compatible with Frontend and API features
    - Business logic/computation
        - users should be able to use functions with inputs and view outputs/side-effects
        - abstract version of the above three
- Mocking:
    - There will very likely be cases where a module in isolation cannot be fully demonstrated in an isolated manner
    - This could be upstream or downstream dependencies
    - In this case, we must be able to rely on mocking those dependencies
    - There should be a clear indicator for which dependencies are pure source and which are mocked
    - There should be a clear way to view the effects of an interaction (though this can be for source or mocked components)
    - This is especially important for data dependencies; being able to quickly create mock data on the fly is important to enable rapid interactivity

Implementation notes:

- Existing software:
    - There is very likely existing software that performs certain parts of this vision of tourguide, perhaps even software that does it all
    - Searching wide for such software will let us avoid re-inventing things unnecessarily
    - Frontend, API, data modeling are solved problems
    - Documentation generation is also likely a solved problem
- LLM Angle:
    - This is engine for generating annotations
    - However, this system benefits tremendously from existing documentation
        - As stated earlier, a tour is just a top-down structured way of presenting documentation
    - Another possible angle for re-use is seeing if there exists adaptible mechanisms for generating docs
- Interaction notes:
    - With early software, there may very well be bugs that surface when going to do interactions
    - Building tours will assume components work the way they are said to work
    - This platform provides evidence-based bug report generation that can be used to provide very useful context to devs/agents to fix bugs as user discovers them, so keep that in mind
- Cost:
    - We want to be efficient with LLM use
    - This is why leveraging documentation is so important
    - Using references to documentations/mocking will let us create tours that can withstand (meaningful/correct) changes to source code and still hold up as valid tours
    - We don't want users to lose a bunch of tokens without them knowing, so keeping visibility/having proper permission UI is important here
- Bad code:
    - Undeniably this application works most effectively and efficiently on codebases that are well structured
    - Not entirely sure how to deal with this lol
    - Suggesting refactors to allow for the right level of modularity to enable tourguide to work well is a start, perhaps a skill of our own or another leveraged for re-use could help us achieve this as well
    

