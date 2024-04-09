import inquirer from "inquirer";
import cfonts from "cfonts";

const greeter = (name: string) => {
  console.log(`👋 Welcome ${name}! `);
};

interface UsernameResponse {
  username: string;
}

export const cli = async () => {
  cfonts.say("zkSync Era\n Validator Tool", {
    colors: ["red", "gray"],
    font: "block",
    align: "left",
    // background: 'transparent',  // define the background color, you can also use `backgroundColor` here as key
    // letterSpacing: 1,           // define letter spacing
    // lineHeight: 1,              // define the line height
    // space: true,                // define if the output text should have empty lines on top and on the bottom
    // maxLength: '0',             // define how many character can be on one line
    // gradient: false,            // define your two gradient colors
    // independentGradient: false, // define if you want to recalculate the gradient for each new line
    // transitionGradient: false,  // define if this is a transition between colors directly
    // env: 'node'
  });

  const response = await inquirer.prompt<UsernameResponse>({
    type: "input",
    name: "username",
    message: "What is your username?",
  });
  greeter(response.username);
};
