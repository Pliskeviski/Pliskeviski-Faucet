/*

    Gustavo Pliskeviski
    6/20/2018
    
*/

var express    = require("express"),
    request    = require("request"),
    mongoose   = require("mongoose"),
    bodyParser = require("body-parser"),
    Cryptopia  = require("cryptopia-api")(),
    forceSsl   = require('express-force-ssl'),
    fs         = require('fs'),
    http       = require('http'),
    https      = require('https'),
    cookieParser = require('cookie-parser');
// Atual - para subir
mongoose.connect("mongodb url", function(err, db){
    if(err) throw err
    console.log("Connect to DB");
});

var privateKey  = fs.readFileSync('sslcert/ your server key', 'utf8');
var certificate = fs.readFileSync('sslcert/ your server certificate', 'utf8');

var credentials = {key: privateKey, cert: certificate};

var app = express();
app.use(forceSsl);

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.set("view engine", "ejs");

app.use('/', express.static(__dirname + "/public"));
app.use(cookieParser());

const options = { // Cryptopia
    API_KEY: 'YOUR-API-KEY',
    API_SECRET: 'YOUR-API-SECRET-KEY',
    HOST_URL: 'https://www.cryptopia.co.nz/api'
};
Cryptopia.setOptions(options);

var UserSchema = new mongoose.Schema({
    points: Number,
    wallet: {type: String, default: "none please update"},
    lastIP: String,
    lastClick: Number
});
var User = mongoose.model("User", UserSchema);

var lastIPs = [];

app.get("/", function(req, res) {

    var ip = req.headers['x-forwarded-for'] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);

    if(req.cookies.rddFctPli_wallet === undefined) {
        var usr = {
            points: 0,
            wallet: "none please update",
            lastClick: 0,
            lastIP: ip
        }
        console.log("undefined user: " + ip);
        return res.render("index", {user: usr, captcha : "Undef", pts: 0, balance: 0, time: usr.lastClick, alrt: ""});       
    } else {
        var w_str = req.cookies.rddFctPli_wallet.toString();
        if(w_str.length > 20) { // Valid address
            // Check if user exists
            User.findOne({wallet: req.cookies.rddFctPli_wallet}, function(err, user){
                if(err) console.log("Error(1)");
                if(user === null) { // Create new user
                    User.create({
                        points: 0,
                        wallet: req.cookies.rddFctPli_wallet,
                        lastClick: 0,
                        lastIP: ip
                    }, function(err, newUser){
                        if(err) console.log("Error(2)");

                        console.log("User created  " + ip);
                        res.render("index", {user: newUser, captcha : "Undef", pts: req.cookies.rddFctPli_lastPts, balance: newUser.points, time: newUser.lastClick, alrt: req.cookies.rddFctPli_alrt}, function(err, html){
                            res.cookie('rddFctPli_lastPts', 0, {maxAge: 10 * 365 * 24 * 60 * 60});
                            res.cookie('rddFctPli_alrt', "", {maxAge: 10 * 365 * 24 * 60 * 60});
                            res.cookie('rddFctPli_bal', newUser.points.toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                            res.send(html);
                        });
                    });
                } else { // User exists
                    console.log("User returned " + ip);
                    res.cookie('rddFctPli_bal', user.points.toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                    var dt = new Date();
                    var timeToCheck = user.lastClick;
                    lastIPs.forEach(function(l){
                        if(l.IP === ip) {
                            timeToCheck = l.date;
                        }
                    });
                    var diff = (Math.abs(timeToCheck - dt.getTime()) / 3600000) * 60;
                    var time = false;
                    if(diff >= 59) {
                        time = -1;
                    } else {
                        time = 60 - diff;
                    }
                    return res.render("index", {user: user, captcha : "Undef", pts: req.cookies.rddFctPli_lastPts, balance: user.points, time: time, alrt: req.cookies.rddFctPli_alrt}, function(err, html){
                        res.cookie('rddFctPli_lastPts', 0, {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.cookie('rddFctPli_alrt', "", {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.cookie('rddFctPli_bal', user.points.toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                        user.lastIP = ip;
                        User.findOneAndUpdate({wallet: req.cookies.rddFctPli_wallet}, user, function(err){
                            if(err) console.log("Error (3)");
                            res.send(html);
                        });
                    });
                }
            });
        } else { // Invalid Address
            console.log("Invalid address " + w_str.length);
            var usr = {
                points: 0,
                wallet: "none please update",
                lastClick: 0,
                lastIP: ip
            }
            res.cookie('rddFctPli_wallet', "none please update", {maxAge: 10 * 365 * 24 * 60 * 60});
            return res.render("index", {user: usr, captcha : "Undef", pts: 0, balance: 0, time: usr.lastClick, alrt: "Please add a valid RDD address!"});
        }
    }
});

app.post("/", function(req, res) {
    var ip = req.headers['x-forwarded-for'] || 
            req.connection.remoteAddress || 
            req.socket.remoteAddress ||
            (req.connection.socket ? req.connection.socket.remoteAddress : null);
    console.log("Captcha - ip: " + ip);
    if(req.body['g-recaptcha-response'] === undefined || req.body['g-recaptcha-response'] === '' || req.body['g-recaptcha-response'] === null) {
        res.cookie("rddFctPli_captcha", "Undef", {maxAge: 10 * 365 * 24 * 60 * 60}); 
        return res.redirect("/");
    } else {
        const secretKey = "YOUR-RECAPCHA-SECRET-KEY"; // Must be changed
        const verificationURL = "https://www.google.com/recaptcha/api/siteverify?secret=" + secretKey + "&response=" + req.body['g-recaptcha-response'] + "&remoteip=" + req.connection.remoteAddress;
        request(verificationURL,function(error,response,body) {
            body = JSON.parse(body);
            if(body.success !== undefined && !body.success) {
                res.cookie("rddFctPli_captcha", "Undef", {maxAge: 10 * 365 * 24 * 60 * 60}); 
                return res.redirect("/");
            } else {
                User.findOne({wallet: req.cookies.rddFctPli_wallet}, function(err, user) {
                    if(err) console.log("Error (4)");
                    var dt = new Date();
                    var timeToCheck = user.lastClick;
                    lastIPs.forEach(function(l){
                        if(l.IP === ip) {
                            timeToCheck = l.date;
                        }
                    });
                    var diff = (Math.abs(timeToCheck - dt.getTime()) / 3600000) * 60;
                    var time = false;
                    if(diff >= 59) {
                        time = -1;
                    } else {
                        time = 60 - diff;
                    }
                    res.render("index", {user: user, captcha : "OK", pts: req.cookies.rddFctPli_lastPts, balance: user.points, time: user.lastClick, alrt: req.cookies.rddFctPli_alrt}, function(err, html){
                        res.cookie('rddFctPli_lastPts', 0, {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.cookie('rddFctPli_alrt', "", {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.cookie('rddFctPli_bal', user.points.toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.cookie("rddFctPli_captcha", "OK", {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.send(html);
                    });
                });
            }
        });
    }
});

app.post("/run", function(req, res) {
    var ip = req.headers['x-forwarded-for'] || 
            req.connection.remoteAddress || 
            req.socket.remoteAddress ||
            (req.connection.socket ? req.connection.socket.remoteAddress : null);
    if(req.cookies.rddFctPli_captcha === "OK") {
        User.findOne({wallet: req.cookies.rddFctPli_wallet}, function(err, user) {
            console.log("User found!");
            if(err) console.log("Error (5)");
            var dt = new Date();
            var timeToCheck = user.lastClick;
            lastIPs.forEach(function(l){
                if(l.IP === ip) {
                    timeToCheck = l.date;
                }
            });
            var diff = (Math.abs(timeToCheck - dt.getTime()) / 3600000) * 60;
            if(diff >= 59) {
                request("https://www.random.org/integers/?num=1&min=1&max=1000&col=1&base=10&format=plain&rnd=new", function(error, response, body){
                    if(!error && response.statusCode == 200) {
                        var pts = 0;
                        if(body < 300){
                            console.log("30% | 0.05");
                            pts = 0.05;
                        }
                        if(body >= 300 && body < 800){
                            console.log("50% | 0.1");
                            pts = 0.1;
                        }
                        if(body >= 800 && body < 900){
                            console.log("10% | 0.25");
                            pts = 0.25;
                        }
                        if(body >= 900 && body < 980){
                            console.log("8% | 0.5");
                            pts = 0.5;
                        }
                        if(body >= 980 && body <= 1000){
                            console.log("2% | 1");
                            pts = 1;
                        }

                        (async () => {
                            User.findOne({wallet: req.cookies.rddFctPli_wallet}, function(err, user){
                                if(err) console.log("Error (6)");
                                res.cookie('rddFctPli_bal', (user.points + pts).toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                                var finalPts = user.points + pts;
                                user.points = finalPts;
                                var date = new Date();
                                user.lastClick = date.getTime();
                                user.lastIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : null);
                                User.findOneAndUpdate({wallet: req.cookies.rddFctPli_wallet}, user, function(err, user){
                                    if(err) {
                                        if(err) console.log("Error (7)");
                                        return res.redirect("/");
                                    }
                                    lastIPs.push({
                                        IP: user.lastIP,
                                        date: date.getTime()
                                    });
                                    
                                    res.cookie('rddFctPli_lastPts', pts, {maxAge: 10 * 365 * 24 * 60 * 60});
                                    res.cookie("rddFctPli_captcha", "Undef", {maxAge: 10 * 365 * 24 * 60 * 60});
                                    res.redirect("/");
                                });
                            });
                        })();
                    }
                });
            } else {
                res.redirect("/");
            }
        });
    } else {
        return res.redirect("/");
    }
});

app.post("/update", function(req, res) {
    var ip = req.headers['x-forwarded-for'] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);
    var wallet = req.body.wallet.toString();
    console.log("Address: " + wallet + " ip: " + ip);
    res.cookie("rddFctPli_wallet", wallet.replace(/\s/g,''), {maxAge: 10 * 365 * 24 * 60 * 60});
    res.redirect("/");
});

app.post("/withdraw", function(req, res){
    (async () => {
        User.findOne({wallet: req.cookies.rddFctPli_wallet}, function(err, user) {
	    if(user.wallet === "none please update"){
                res.cookie('rddFctPli_alrt', "Please update your wallet address", {maxAge: 10 * 365 * 24 * 60 * 60});
                return res.redirect("/");
            }
            if(err) { 
                if(err) console.log("Error (8)");
                console.error("/withdraw error: (first function()) " + err);
            }
            if(user.points > 4.9){
                (async function () {
                    try {
                        const submitWithdraw = await Cryptopia.submitWithdraw({Currency: 'RDD', Address: user.wallet, PaymentId: 'your payment id', Amount: user.points});
                            console.log("New withdraw: wallet " + user.wallet + " " + submitWithdraw);
                            var amt = user.points;
                            user.points = 0;
                            res.cookie('rddFctPli_bal', user.points.toString(), {maxAge: 10 * 365 * 24 * 60 * 60});
                            User.findOneAndUpdate({wallet: user.wallet}, user, function(err){});

                            User.findOne({wallet: "admin"}, function(err, admin){
                                var adminPts = admin.points + amt;
                                admin.points = adminPts;
                                User.findOneAndUpdate({wallet: "admin"}, admin, function(err){});
                            });
                            return res.redirect("/");
                    } catch (err) {
                        console.error("/withdraw error: (second function()) " + err);
                        res.cookie('rddFctPli_alrt', "Something went wrong", {maxAge: 10 * 365 * 24 * 60 * 60});
                        res.redirect("/");
                    }
                })();
                
            } else {
                res.cookie('rddFctPli_alrt', "Withdraw amount is below the minimum, Minimum: 5 RDD", {maxAge: 10 * 365 * 24 * 60 * 60});
                return res.redirect("/");
            }
        });
    })();
});

app.get("/adblock", function(req, res){
    res.render("adblock");
});

app.post("/reset", function(req, res){
    res.clearCookie("rddFctPli_wallet");
    res.clearCookie("rddFctPli_id");
    res.clearCookie("rddFctPli_bal");
    res.clearCookie("rddFctPli_alrt");
    res.redirect("/");
});

app.get("*", function(req, res){
    return res.redirect("your page url");
});

var httpServer = http.createServer(app).listen(80);
var httpsServer = https.createServer(credentials, app).listen(443);
