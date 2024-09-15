#!/bin/bash

export GIT_REPO_URL="$GIT_REPO_URL"

git clone "$GIT_REPO_URL" ./home/app/output

if [ $? -ne 0 ]; then
    export ERROR_MESSAGE="Failed to clone the project. Please check your github project link!"
    export ERROR_CODE="project_cloning_failed"
    exec node error-handler.js
    exit 1
fi

cd ./home/app/output

# Function to check for potentially malicious commands in package.json
check_malicious_package_scripts() {
    local file="package.json"

    echo "Checking package.json for malicious scripts..."

    # List of potentially malicious commands to look for
    local patterns=(
        'rm -rf'         # Destructive file deletion
        'sudo'           # Privileged execution
        'eval'           # Arbitrary command execution
        'bash -c'        # Running commands via bash
        'sh -c'          # Running commands via sh
        'curl'           # Fetching data from the internet
        'wget'           # Fetching data from the internet
        'nc '            # Netcat for networking
        '>:|&'           # Fork bomb
        '>/dev/tcp'      # Opening network sockets
        '>/dev/udp'      # Opening network sockets
    )

    # Search for malicious patterns in package.json "scripts" section
    for pattern in "${patterns[@]}"; do
        if grep -E "$pattern" "$file" >/dev/null; then
            cd ../../../
            
            echo "Warning: Potentially malicious pattern '$pattern' found in package.json"
            export ERROR_MESSAGE="Potentially malicious pattern '$pattern' found in package.json"
            export ERROR_CODE="malicious_code_found"
            exec node error-handler.js
            exit 1
        fi
    done

    echo "No malicious scripts found in package.json."
}

validate_project_structure() {
    
    # 1. Check for package.json
    if [ -f "package.json" ]; then
        echo "package.json found."

        # 2. Check for frontend frameworks
        if grep -q '"react"' "package.json"; then
            echo "React project detected."
        elif grep -q '"vue"' "package.json"; then
            echo "Vue.js project detected."
        elif grep -q '"@angular/core"' "package.json"; then
            echo "Angular project detected."
        else
            cd ../../../
            echo "No specific frontend framework detected."
            export ERROR_MESSAGE="No specific frontend framework detected. your project must be in either react, vue or angular!"
            export ERROR_CODE="no_framework_detected"
            exec node error-handler.js
            exit 1
        fi

        # 3. Check for build script
        if grep -q '"build"' "package.json"; then
            echo "Build script found."
        else
            cd ../../../
            echo "No build script found."
            export ERROR_MESSAGE="No build script found. Your package.json must have build script!"
            export ERROR_CODE="build_script_not_found"
            exec node error-handler.js
            exit 1
        fi
    else
        cd ../../../
        echo "package.json not found. Not a frontend project."
        export ERROR_MESSAGE="package.json not found. Not a modern frontend project. your project must be in either react, vue or angular!"
        export ERROR_CODE="not_a_modern_frontend_project"
        exec node error-handler.js
        exit 1
    fi
}

install_dependencies() {
    echo "Installing dependencies"
    npm install
}

check_dependency_vulnerabilities() {
    echo "Running npm audit..."
    npm audit --production --audit-level=high

    if [ $? -ne 0 ]; then
        cd ../../../
        echo "High-severity vulnerabilities found. Exiting..."
        export ERROR_MESSAGE="High-severity vulnerabilities found in your project. We can't deploy your project!"
        export ERROR_CODE="hight_vulnerabilities_found"
        exec node error-handler.js
        exit 1
    fi

    echo "No vulnerabilities found!"
}



validate_project_structure

check_malicious_package_scripts

install_dependencies

check_dependency_vulnerabilities



cd ../../../
exec node script.js
exit 1