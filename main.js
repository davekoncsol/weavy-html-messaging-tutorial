

//client id = clientid
//secret = clientsecret

var sub = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJjbGllbnRpZCIsImlhdCI6MTU5ODU3NDUyOCwiZXhwIjoxNjMwMTEwNTMwLCJhdWQiOiJrbmVjdElRIiwic3ViIjoianJvY2tldEBleGFtcGxlLmNvbSJ9.5vV3EEyhcUJzJt_96n-cZnqWt4_8NtQ9USQl_Ur7W0o';
// ---------------------------------

// Weavy.defaults.url = "https://localhost:44323/";
 


  if (sub!='') {
    // -- Simplified login with your JWT sub
    var weavy = new Weavy({ jwt: sub }); 

    // -- Create a space in <weavy/>, using sub here as key too - can be anything, but should be unique
    // -- This key is what you use to uniquely attach a space to any view within your app.
    var weavySpace = weavy.space({ key: 'testing' });

    // -- Adding our features to the space (we call it apps), and injects them into the DOM (container)
    // -- All content now created (files, posts, tasks, etc) is now associated with this space 
    weavySpace.app({ key: "feed", type: "posts", container: "#feed-placeholder" });
    weavySpace.app({ key: "files", type: "files", container: "#files-placeholder" });
    weavySpace.app({ key: "tasks", type: "tasks", container: "#tasks-placeholder" });
    weavySpace.app({ key: "messenger", type: "messenger", container: "#messenger-placeholder" });

    // -- Handle badge update for new messages
        weavy.on("badge", function (e, data) {
            console.log(e)
            console.log(data)
            var im = $("#instantmessaging");
            data.conversations > 0 ? im.addClass("has-unread") : im.removeClass("has-unread");
        });
  }

// ---------------------------------

$('.header li').click(function() {
  if ($(this).hasClass('active')) {
    $(this).removeClass('active');
  } else {
    $('.header li').removeClass('active');
    $(this).addClass('active');
  }
});

$('.layer-header i').click(function() {
  $(this).parent().parent().removeClass('active');
});
