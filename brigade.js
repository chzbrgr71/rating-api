const { events, Job, Group } = require('brigadier')

events.on("push", (brigadeEvent, project) => {
    
    // setup variables
    var gitPayload = JSON.parse(brigadeEvent.payload)
    var brigConfig = new Map()
    brigConfig.set("acrServer", project.secrets.acrServer)
    brigConfig.set("acrName", project.secrets.acrName)
    brigConfig.set("azServicePrincipal", project.secrets.azServicePrincipal)
    brigConfig.set("azClientSecret", project.secrets.azClientSecret)
    brigConfig.set("azTenant", project.secrets.azTenant)
    brigConfig.set("gitSHA", brigadeEvent.revision.commit.substr(0,7))
    brigConfig.set("eventType", brigadeEvent.type)
    brigConfig.set("branch", getBranch(gitPayload))
    brigConfig.set("apiImage", "chzbrgr71/rating-api")
    brigConfig.set("imageTag", `${brigConfig.get("branch")}-${brigConfig.get("gitSHA")}`)
    brigConfig.set("acrImage", `${brigConfig.get("apiImage")}:${brigConfig.get("imageTag")}`)

    console.log(`==> gitHub webook (${brigConfig.get("branch")}) with commit ID ${brigConfig.get("gitSHA")}`)
    
    // setup brigade jobs
    var acrbuilder = new Job("job-runner-acr-builder")
    var helm = new Job("job-runner-helm")
    acrJobRunner(brigConfig, acrbuilder)
    helmJobRunner(brigConfig, helm)
    
    // start pipeline
    console.log(`==> starting pipeline for docker image: ${brigConfig.get("apiImage")}:${brigConfig.get("imageTag")}`)
    var pipeline = new Group()
    pipeline.add(acrbuilder)
    pipeline.add(helm)
    
    if (brigConfig.get("branch") == "master") {
        pipeline.runEach()
    } else {
        console.log(`==> no jobs to run when not master`)
    }  
})

events.on("after", (event, proj) => {
    console.log("brigade pipeline finished successfully")    
})

function acrJobRunner(config, acr) {
    acr.storage.enabled = false
    acr.image = "briaracreu.azurecr.io/chzbrgr71/azure-cli:0.0.5"
    acr.tasks = [
        "cd /src/",
        `az login --service-principal -u ${config.get("azServicePrincipal")} -p ${config.get("azClientSecret")} --tenant ${config.get("azTenant")}`,
        `az acr build -t ${config.get("acrImage")} --build-arg IMAGE_TAG_REF=${config.get("imageTag")} -f ./Dockerfile --context . -r ${config.get("acrName")}`
    ]
}

function helmJobRunner (config, h) {
    h.storage.enabled = false
    h.image = "briaracreu.azurecr.io/chzbrgr71/k8s-helm:v2.8.2"
    h.tasks = [
        "cd /src/",
        "git clone https://github.com/chzbrgr71/rating-charts.git",
        "cd rating-charts",
        `helm upgrade --install --reuse-values rating-api ./rating-api --set api.imageTag=${config.get("imageTag")}`
    ]
}

function slackJob (s, webhook, message) {
    s.storage.enabled = false
    s.env = {
      SLACK_WEBHOOK: webhook,
      SLACK_USERNAME: "brigade-demo",
      SLACK_MESSAGE: message,
      SLACK_COLOR: "#0000ff"
    }
}

function getBranch (p) {
    if (p.ref) {
        return p.ref.substring(11)
    } else {
        return "PR"
    }
}
